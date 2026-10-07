/**
 * =========================================================================
 * 應用層控制器 (app.js)
 * =========================================================================
 */
import {
  initDb, dbQuery, calcIQR, analyzeDAG, willCreateCycle,
  buildDependencyClosures, runKnapsackDP, runGreedyFair
} from './core.js';

let expenseData = [];
let taskData = [];

const CATEGORY_MAP = {
  expense: ['飲食日常', '交通出行', '居家開銷', '學習研究', '娛樂社交', '其他支出'],
  income: ['打工薪資', '專案外快', '獎學金', '投資收入', '其他收入']
};

export function changeTab(tab) {
  const isExp = tab === 'expense';
  document.getElementById('secExpense').classList.toggle('hidden', !isExp);
  document.getElementById('secTask').classList.toggle('hidden', isExp);
  document.getElementById('btnTabExpense').classList.toggle('active', isExp);
  document.getElementById('btnTabTask').classList.toggle('active', !isExp);
}

export function switchCategories() {
  const type = document.getElementById('expType').value;
  const catSel = document.getElementById('expCategory');
  catSel.innerHTML = '';
  CATEGORY_MAP[type].forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    catSel.appendChild(opt);
  });
}

export async function loadData() {
  try {
    expenseData = await dbQuery.getAll('expenses');
    taskData = await dbQuery.getAll('tasks');
    expenseData.sort((a, b) => new Date(b.date) - new Date(a.date));
    await renderExpenses();
    renderTasks();
    updateTaskPreReqOptions();
  } catch (err) {
    console.error("載入失敗:", err);
  }
}

export async function renderExpenses() {
  const listEl = document.getElementById('expenseList');
  const search = document.getElementById('searchExp').value.trim().toLowerCase();
  const filterCat = document.getElementById('filterCategory').value;
  const mode = document.getElementById('selIqrMode').value;
  const activeCat = document.getElementById('expCategory').value;

  listEl.innerHTML = '';
  let inc = 0, exp = 0;
  let targetArr = [];
  let isFallback = false;

  if (mode === 'rolling') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const localThirtyDaysAgo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rollingExpenses = await dbQuery.getByDateRange('expenses', localThirtyDaysAgo);
    targetArr = rollingExpenses.filter(x => x.type === 'expense' && x.category === activeCat);

    if (targetArr.length < 4) {
      targetArr = expenseData.filter(x => x.type === 'expense' && x.category === activeCat);
      isFallback = true;
    }
  } else if (mode === 'stratified') {
    targetArr = expenseData.filter(x => x.type === 'expense' && x.category === activeCat);
  } else {
    targetArr = expenseData.filter(x => x.type === 'expense');
  }

  const amounts = targetArr.map(x => Number(x.amount));
  const iqrRes = calcIQR(amounts);

  document.getElementById('lblQ1').textContent = `常態低標: $${Math.round(iqrRes.q1)}`;
  document.getElementById('lblMed').textContent = `中位數: $${Math.round(iqrRes.med)}`;
  document.getElementById('lblQ3').textContent = `常態高標: $${Math.round(iqrRes.q3)}`;
  document.getElementById('lblAlert').textContent = `預警線: $${Math.round(iqrRes.highLimit)} ${isFallback ? '(樣本<4，已自動回退歷史基準)' : ''}`;

  const filterSel = document.getElementById('filterCategory');
  const oldVal = filterSel.value;
  filterSel.innerHTML = '<option value="">全部分類</option>';
  [...new Set(expenseData.map(x => x.category))].forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === oldVal) opt.selected = true;
    filterSel.appendChild(opt);
  });

  let hasData = false;
  expenseData.forEach(item => {
    const amt = Number(item.amount);
    if (item.type === 'income') inc += amt;
    else exp += amt;

    if (filterCat && item.category !== filterCat) return;
    if (search && !item.item.toLowerCase().includes(search)) return;
    hasData = true;

    const isOutlier = item.type === 'expense' && iqrRes.highLimit > 0 && amt >= iqrRes.highLimit;

    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <div class="item-info">
        <div class="item-top">
          <span class="tag tag-category">${item.category}</span>
          <strong>${item.item}</strong>
          <span style="font-weight:bold; color:${item.type === 'income' ? '#38a169' : '#e53e3e'}">
            ${item.type === 'income' ? '+' : '-'}$${amt.toLocaleString()}
          </span>
          <span class="tag">${item.payment}</span>
          ${isOutlier ? '<span class="tag tag-warning">異常大額</span>' : ''}
        </div>
        <div style="font-size:0.75rem; color:#718096;">
          <span>${item.date}</span>
          ${item.note ? `<span> | ${item.note}</span>` : ''}
        </div>
      </div>
      <div>
        <button class="btn-sm" onclick="editExpense('${item.id}')">編輯</button>
        <button class="btn-sm del" onclick="delExpense('${item.id}')">刪除</button>
      </div>
    `;
    listEl.appendChild(row);
  });

  if (!hasData) {
    listEl.innerHTML = '<div style="text-align:center; color:#a0aec0; padding:20px; font-size:0.85rem;">暫無記錄</div>';
  }

  document.getElementById('valIncome').textContent = `$${inc.toLocaleString()}`;
  document.getElementById('valExpense').textContent = `$${exp.toLocaleString()}`;
  const bal = inc - exp;
  const balEl = document.getElementById('valBalance');
  balEl.textContent = `$${bal.toLocaleString()}`;
  balEl.style.color = bal >= 0 ? '#38a169' : '#e53e3e';
}

export async function saveExpense(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btnSubmitExp');
  submitBtn.disabled = true;

  try {
    const id = document.getElementById('editExpId').value || 'exp_' + Date.now();
    const data = {
      id,
      type: document.getElementById('expType').value,
      amount: Math.abs(Number(document.getElementById('expAmount').value)),
      category: document.getElementById('expCategory').value,
      item: document.getElementById('expItem').value.trim(),
      payment: document.getElementById('expPayment').value,
      date: document.getElementById('expDate').value,
      note: document.getElementById('expNote').value.trim()
    };

    await dbQuery.save('expenses', data);
    resetExpForm();
    await loadData();
  } catch (err) {
    alert("儲存失敗: " + err.message);
  } finally {
    submitBtn.disabled = false;
  }
}

export function editExpense(id) {
  const it = expenseData.find(x => x.id === id);
  if (!it) return;
  document.getElementById('editExpId').value = it.id;
  document.getElementById('expType').value = it.type;
  switchCategories();
  document.getElementById('expCategory').value = it.category;
  document.getElementById('expAmount').value = it.amount;
  document.getElementById('expItem').value = it.item;
  document.getElementById('expPayment').value = it.payment;
  document.getElementById('expDate').value = it.date;
  document.getElementById('expNote').value = it.note || '';

  document.getElementById('btnSubmitExp').textContent = '更新';
  document.getElementById('btnCancelExp').classList.remove('hidden');
}

export function resetExpForm() {
  document.getElementById('formExpense').reset();
  document.getElementById('editExpId').value = '';
  document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('btnSubmitExp').textContent = '儲存記錄';
  document.getElementById('btnCancelExp').classList.add('hidden');
}

export async function delExpense(id) {
  if (confirm('確定要刪除這筆資料？')) {
    await dbQuery.remove('expenses', id);
    await loadData();
  }
}

export function updateTaskPreReqOptions(excludeId = null) {
  const sel = document.getElementById('taskPreReq');
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">無前置條件 (獨立任務)</option>';

  taskData.forEach(t => {
    if (excludeId && (t.id === excludeId || willCreateCycle(excludeId, t.id, taskData))) {
      return;
    }
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `[${t.priority}] ${t.title} (${t.hours}h)`;
    if (t.id === currentVal) opt.selected = true;
    sel.appendChild(opt);
  });
}

export function renderTasks(highlightIds = []) {
  const listEl = document.getElementById('taskList');
  listEl.innerHTML = '';

  if (taskData.length === 0) {
    listEl.innerHTML = '<div style="text-align:center; color:#a0aec0; padding:20px; font-size:0.85rem;">暫無待辦事項</div>';
    return;
  }

  taskData.forEach(item => {
    const isPicked = highlightIds.includes(item.id);
    const preReqTask = taskData.find(x => x.id === item.preReqId);

    const row = document.createElement('div');
    row.className = 'list-item';
    if (isPicked) {
      row.style.border = '1px solid #3182ce';
      row.style.background = '#ebf8ff';
    }

    row.innerHTML = `
      <div class="item-info">
        <div class="item-top">
          <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleTask('${item.id}')">
          <span class="tag tag-prio-high">優先: ${item.priority}</span>
          ${item.tag ? `<span class="tag">${item.tag}</span>` : ''}
          ${preReqTask ? `<span class="tag tag-dep">需先完成: ${preReqTask.title}</span>` : ''}
          <strong style="${item.completed ? 'text-decoration:line-through; color:#a0aec0;' : ''}">${item.title}</strong>
          <span style="font-size:0.75rem; color:#718096;">(${item.hours}h)</span>
          ${isPicked ? '<span class="tag" style="background:#3182ce; color:#fff;">DP 閉包推薦排程</span>' : ''}
        </div>
        <div style="font-size:0.75rem; color:#718096;">
          ${item.deadline ? `<span>截止: ${item.deadline.replace('T', ' ')}</span> | ` : ''}
          <span>${item.desc || '無備註'}</span>
        </div>
      </div>
      <div>
        <button class="btn-sm" onclick="sendMailReminder('${item.id}')">通知</button>
        <button class="btn-sm" onclick="editTask('${item.id}')">編輯</button>
        <button class="btn-sm del" onclick="delTask('${item.id}')">刪除</button>
      </div>
    `;
    listEl.appendChild(row);
  });
}

export async function saveTask(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btnSubmitTask');
  submitBtn.disabled = true;

  try {
    const id = document.getElementById('editTaskId').value || 'task_' + Date.now();
    const priority = document.getElementById('taskPriority').value;
    const preReqId = document.getElementById('taskPreReq').value;
    const weightMap = { '高': 3, '中': 2, '低': 1 };

    if (preReqId && willCreateCycle(id, preReqId, taskData)) {
      alert("錯誤：設定此相依任務將引發循環死結（Cycle Detected），系統已拒絕儲存！");
      submitBtn.disabled = false;
      return;
    }

    const data = {
      id,
      title: document.getElementById('taskTitle').value.trim(),
      hours: Number(document.getElementById('taskHours').value),
      priority,
      weight: weightMap[priority] || 2,
      preReqId: preReqId || null,
      tag: document.getElementById('taskTag').value.trim(),
      deadline: document.getElementById('taskDeadline').value,
      desc: document.getElementById('taskDesc').value.trim(),
      completed: false
    };

    const old = taskData.find(x => x.id === id);
    if (old) data.completed = old.completed;

    await dbQuery.save('tasks', data);
    resetTaskForm();
    await loadData();
  } catch (err) {
    alert("儲存事項失敗: " + err.message);
  } finally {
    submitBtn.disabled = false;
  }
}

export function editTask(id) {
  const it = taskData.find(x => x.id === id);
  if (!it) return;
  document.getElementById('editTaskId').value = it.id;
  document.getElementById('taskTitle').value = it.title;
  document.getElementById('taskHours').value = it.hours;
  document.getElementById('taskPriority').value = it.priority;
  document.getElementById('taskTag').value = it.tag || '';
  document.getElementById('taskDeadline').value = it.deadline || '';
  document.getElementById('taskDesc').value = it.desc || '';

  updateTaskPreReqOptions(it.id);
  document.getElementById('taskPreReq').value = it.preReqId || '';

  document.getElementById('btnSubmitTask').textContent = '更新';
  document.getElementById('btnCancelTask').classList.remove('hidden');
}

export function resetTaskForm() {
  document.getElementById('formTask').reset();
  document.getElementById('editTaskId').value = '';
  document.getElementById('btnSubmitTask').textContent = '儲存事項';
  document.getElementById('btnCancelTask').classList.add('hidden');
  updateTaskPreReqOptions();
}

export async function toggleTask(id) {
  const it = taskData.find(x => x.id === id);
  if (it) {
    it.completed = !it.completed;
    await dbQuery.save('tasks', it);
    renderTasks();
  }
}

export async function delTask(id) {
  if (confirm('確定刪除此事項？')) {
    await dbQuery.remove('tasks', id);
    const children = taskData.filter(x => x.preReqId === id);
    for (const child of children) {
      child.preReqId = null;
      await dbQuery.save('tasks', child);
    }
    await loadData();
  }
}

export function runSchedulingAlgorithm() {
  const limit = Number(document.getElementById('limitHours').value) || 6;
  const uncompleted = taskData.filter(x => !x.completed);

  if (uncompleted.length === 0) {
    alert('無未完成事項可進行排程。');
    return;
  }

  const dagRes = analyzeDAG(uncompleted);
  document.getElementById('resDagTime').innerText = `${dagRes.timeUs} μs`;
  if (dagRes.hasCycle) {
    document.getElementById('resDagStatus').innerText = "⚠️ 循環死結 (Cycle Detected)";
    alert("警告：任務相依關係中存在循環死結，請檢查前置設定！");
    return;
  } else {
    document.getElementById('resDagStatus').innerText = "✔ 無環圖有效 (DAG Valid)";
  }

  const closureCandidates = buildDependencyClosures(uncompleted, taskData);
  const dpRes = runKnapsackDP(closureCandidates, limit);
  const greedyRes = runGreedyFair(closureCandidates, taskData, limit);

  const uniqueTaskIds = new Set();
  dpRes.rawPicks.forEach(p => {
    (p.bundledTaskIds || [p.id]).forEach(tid => uniqueTaskIds.add(tid));
  });

  let exactTotalHours = 0;
  let exactTotalUtility = 0;
  uniqueTaskIds.forEach(tid => {
    const t = taskData.find(x => x.id === tid);
    if (t) {
      exactTotalHours += Number(t.hours);
      exactTotalUtility += Number(t.weight);
    }
  });

  const ratio = exactTotalUtility > 0 ? (greedyRes.totalVal / exactTotalUtility).toFixed(2) : '1.00';

  document.getElementById('resDpUtility').innerText = `${exactTotalUtility} (實選任務: ${uniqueTaskIds.size} 項, 實質工時 ${exactTotalHours}h)`;
  document.getElementById('resDpTime').innerText = `${dpRes.timeUs} μs`;

  document.getElementById('resGreedyUtility').innerText = `${greedyRes.totalVal} (選中閉包: ${greedyRes.picks.length} 組, 實質工時 ${greedyRes.usedHours}h)`;
  document.getElementById('resRatio').innerText = `${ratio} (${Math.round(ratio * 100)}%)`;
  document.getElementById('resGreedyTime').innerText = `${greedyRes.timeUs} μs`;

  renderTasks([...uniqueTaskIds]);
}

export function runTests() {
  const box = document.getElementById('testBox');
  const log = document.getElementById('testLog');
  box.classList.remove('hidden');
  const logs = [];

  const iqrCheck = calcIQR([50, 60]);
  logs.push(iqrCheck.highLimit === 0 ? '✔ [PASS] IQR n<4 防呆驗證成功' : '✖ [FAIL] IQR 邏輯異常');

  const dummyItems = [
    { hours: 2, weight: 3 },
    { hours: 3, weight: 4 },
    { hours: 4, weight: 5 }
  ];
  const dpCheck = runKnapsackDP(dummyItems, 5);
  logs.push(dpCheck.initialVal === 7 ? '✔ [PASS] 0/1 背包 DP 最優解驗證成功 (Val=7)' : '✖ [FAIL] DP 計算錯誤');

  const cycleItems = [
    { id: 'A', preReqId: 'B' },
    { id: 'B', preReqId: 'A' }
  ];
  const cycleCheck = analyzeDAG(cycleItems);
  logs.push(cycleCheck.hasCycle ? '✔ [PASS] DAG 循環死結偵測正確 (A<->B Cycle Detected)' : '✖ [FAIL] DAG 循環未測出');

  const diamondTasks = [
    { id: 'A', title: 'A', hours: 1, weight: 1, preReqId: null, completed: false },
    { id: 'B', title: 'B', hours: 1, weight: 3, preReqId: 'A', completed: false },
    { id: 'C', title: 'C', hours: 1, weight: 3, preReqId: 'A', completed: false }
  ];
  const closures = buildDependencyClosures(diamondTasks, diamondTasks);
  const dpDiamond = runKnapsackDP(closures, 3);
  const dedupIds = new Set();
  dpDiamond.rawPicks.forEach(p => p.bundledTaskIds.forEach(id => dedupIds.add(id)));
  const actualHours = [...dedupIds].reduce((acc, id) => acc + diamondTasks.find(x => x.id === id).hours, 0);
  logs.push(actualHours === 3 && dedupIds.size === 3 ? '✔ [PASS] 分叉相依去重 (Diamond Deduplication) 工時核算正確 (3h)' : '✖ [FAIL] 分叉相依工時重複計算');

  log.innerText = logs.join('\n');
}

export function saveUserEmail() {
  const mail = document.getElementById('userEmail').value.trim();
  localStorage.setItem('user_email', mail);
  alert('信箱已儲存');
}

export function sendMailReminder(id) {
  const it = taskData.find(x => x.id === id);
  if (!it) return;
  const to = localStorage.getItem('user_email') || '';
  const sub = encodeURIComponent(`[待辦提醒] ${it.title}`);
  const body = encodeURIComponent(`事項：${it.title}\n預估工時：${it.hours}h\n截止：${it.deadline || '無'}\n備註：${it.desc || '無'}`);
  window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${sub}&body=${body}`, '_blank');
}

export async function exportJsonFile() {
  const obj = {
    exportDate: new Date().toISOString(),
    expenses: await dbQuery.getAll('expenses'),
    tasks: await dbQuery.getAll('tasks')
  };
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

export function importJsonFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (confirm('匯入將覆蓋現有資料，是否繼續？')) {
        await dbQuery.clear('expenses');
        await dbQuery.clear('tasks');
        for (const it of (data.expenses || [])) await dbQuery.save('expenses', it);
        for (const it of (data.tasks || [])) await dbQuery.save('tasks', it);
        await loadData();
        alert('匯入完成');
      }
    } catch(err) {
      alert('檔案格式錯誤');
    }
  };
  reader.readAsText(file);
}

export function exportCsvData() {
  if (expenseData.length === 0) return alert('無記帳資料');
  const headers = ['類型', '分類', '項目', '金額', '付款方式', '日期', '備註'];
  const rows = expenseData.map(e => [e.type, e.category, e.item, e.amount, e.payment, e.date, e.note || '']);
  const csvStr = '\uFEFF' + [headers, ...rows].map(r => r.map(x => `"${x}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csvStr], { type: 'text/csv;charset=utf-8;' }));
  a.download = `expenses_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

export async function clearAllData() {
  if (confirm('⚠️ 警告：確定要清空所有資料庫資料？此動作無法復原！')) {
    await dbQuery.clear('expenses');
    await dbQuery.clear('tasks');
    await loadData();
    alert('資料已清空');
  }
}

// 掛載至 window 物件，保證 HTML 按鈕點擊正常
Object.assign(window, {
  changeTab, switchCategories, renderExpenses, saveExpense, editExpense,
  resetExpForm, delExpense, saveTask, editTask, resetTaskForm, toggleTask,
  delTask, runSchedulingAlgorithm, runTests, saveUserEmail, sendMailReminder,
  exportJsonFile, importJsonFile, exportCsvData, clearAllData
});

// 啟動資料庫與 UI
window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('userEmail').value = localStorage.getItem('user_email') || '';
  switchCategories();
  try {
    await initDb();
    document.getElementById('db-msg').innerText = "系統資料庫：IndexedDB 已連線";
    await loadData();
  } catch (err) {
    console.error("資料庫啟動失敗:", err);
    document.getElementById('db-msg').innerText = "系統資料庫：連線失敗";
  }
});