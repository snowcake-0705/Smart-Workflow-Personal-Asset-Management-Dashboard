/**
 * =========================================================================
 * 核心引擎模組 (core.js)
 * 涵蓋：IndexedDB B-Tree 索引存取、Kahn DAG 拓撲排序、帶閉包 0/1 背包 DP、滾動 IQR
 * =========================================================================
 */

// 1. IndexedDB 儲存層
const DB_NAME = 'WorkflowDB_v3';
const DB_VERSION = 1;
let dbInstance = null;

export function initDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = (e) => reject(e.target.error);
    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('expenses')) {
        const store = db.createObjectStore('expenses', { keyPath: 'id' });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const store = db.createObjectStore('tasks', { keyPath: 'id' });
        store.createIndex('completed', 'completed', { unique: false });
      }
    };
  });
}

export const dbQuery = {
  getAll: (storeName) => new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error("資料庫尚未就緒"));
    const tx = dbInstance.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }),
  getByDateRange: (storeName, minDate) => new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error("資料庫尚未就緒"));
    const tx = dbInstance.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index('date');
    const range = IDBKeyRange.lowerBound(minDate);
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }),
  save: (storeName, data) => new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error("資料庫尚未就緒"));
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }),
  remove: (storeName, id) => new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error("資料庫尚未就緒"));
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }),
  clear: (storeName) => new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error("資料庫尚未就緒"));
    const tx = dbInstance.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  })
};

// 2. 統計演算法層 (IQR)
export function calcIQR(values) {
  if (values.length < 4) {
    return { q1: 0, med: 0, q3: 0, iqr: 0, highLimit: 0, outlierLimit: 0 };
  }
  const arr = [...values].sort((a, b) => a - b);
  const getP = (p) => {
    const pos = (arr.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    return arr[base] + (arr[base + 1] ? (arr[base + 1] - arr[base]) * rest : 0);
  };

  const q1 = getP(0.25);
  const med = getP(0.5);
  const q3 = getP(0.75);
  const iqr = q3 - q1;

  return {
    q1, med, q3, iqr,
    highLimit: q3 + 1.5 * iqr,
    outlierLimit: q3 + 3.0 * iqr
  };
}

// 3. 圖論演算法層 (Kahn's Algorithm)
export function analyzeDAG(items) {
  const start = performance.now();
  const inDegree = new Map();
  const adj = new Map();

  items.forEach(it => {
    inDegree.set(it.id, 0);
    adj.set(it.id, []);
  });

  items.forEach(it => {
    if (it.preReqId && inDegree.has(it.preReqId)) {
      adj.get(it.preReqId).push(it.id);
      inDegree.set(it.id, (inDegree.get(it.id) || 0) + 1);
    }
  });

  const queue = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const order = [];
  while (queue.length > 0) {
    const u = queue.shift();
    order.push(u);
    for (const v of adj.get(u)) {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    }
  }

  const duration = performance.now() - start;
  return {
    hasCycle: order.length !== items.length,
    order,
    timeUs: (duration * 1000).toFixed(1)
  };
}

export function willCreateCycle(targetId, newPreReqId, items) {
  if (!newPreReqId) return false;
  if (targetId === newPreReqId) return true;

  let curr = items.find(x => x.id === newPreReqId);
  const visited = new Set();
  while (curr) {
    if (curr.id === targetId) return true;
    if (visited.has(curr.id)) return true;
    visited.add(curr.id);
    curr = items.find(x => x.id === curr.preReqId);
  }
  return false;
}

// 4. 運籌演算法層 (相依閉包 0/1 背包 DP 與公平貪婪)
// 修正版：具備多子節點聚合（Shared Parent Closure）的閉包生成器
export function buildDependencyClosures(uncompletedTasks, allTasks) {
  const completedIds = new Set(allTasks.filter(x => x.completed).map(x => x.id));
  const candidateBundles = [];
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  // 1. 為每個未完成任務建立獨立相依鏈閉包
  uncompletedTasks.forEach(task => {
    const bundleTasks = [];
    let curr = task;
    let hasCycle = false;
    const visited = new Set();

    while (curr) {
      if (visited.has(curr.id)) { hasCycle = true; break; }
      visited.add(curr.id);

      if (!completedIds.has(curr.id)) {
        bundleTasks.push(curr);
      }
      curr = curr.preReqId ? taskMap.get(curr.preReqId) : null;
    }

    if (!hasCycle && bundleTasks.length > 0) {
      const dedupMap = new Map();
      bundleTasks.forEach(t => dedupMap.set(t.id, t));
      const uniqueList = Array.from(dedupMap.values());

      const totalHours = uniqueList.reduce((sum, t) => sum + Number(t.hours), 0);
      const totalWeight = uniqueList.reduce((sum, t) => sum + Number(t.weight), 0);
      candidateBundles.push({
        id: task.id,
        title: uniqueList.map(t => t.title).join(' + '),
        hours: totalHours,
        weight: totalWeight,
        bundledTaskIds: uniqueList.map(t => t.id)
      });
    }
  });

  // 2. 關鍵修正：聚合分叉相依（Diamond/Fork Dependency），產生共享父節點的複合閉包
  // 找出所有共同依賴相同前置的子任務群組
  const parentGroups = new Map();
  uncompletedTasks.forEach(t => {
    if (t.preReqId && !completedIds.has(t.preReqId)) {
      if (!parentGroups.has(t.preReqId)) parentGroups.set(t.preReqId, []);
      parentGroups.get(t.preReqId).push(t);
    }
  });

  parentGroups.forEach((children, parentId) => {
    if (children.length >= 2) {
      // 收集父任務及其所有子任務（去重）
      const combinedTaskMap = new Map();
      if (taskMap.has(parentId)) combinedTaskMap.set(parentId, taskMap.get(parentId));
      children.forEach(c => combinedTaskMap.set(c.id, c));

      const combinedTasks = Array.from(combinedTaskMap.values());
      const totalHours = combinedTasks.reduce((sum, t) => sum + Number(t.hours), 0);
      const totalWeight = combinedTasks.reduce((sum, t) => sum + Number(t.weight), 0);

      candidateBundles.push({
        id: `bundle_${parentId}`,
        title: combinedTasks.map(t => t.title).join(' + '),
        hours: totalHours,
        weight: totalWeight,
        bundledTaskIds: combinedTasks.map(t => t.id)
      });
    }
  });

  return candidateBundles;
}

export function runKnapsackDP(items, limitHours) {
  const start = performance.now();
  const scale = 2;
  const W = Math.round(limitHours * scale);
  const N = items.length;

  const dp = Array(W + 1).fill(0);
  const chosen = Array.from({ length: N }, () => Array(W + 1).fill(false));

  const weights = items.map(it => Math.round(Number(it.hours) * scale));
  const values = items.map(it => Number(it.weight));

  for (let i = 0; i < N; i++) {
    const w = weights[i];
    const v = values[i];
    for (let j = W; j >= w; j--) {
      if (dp[j - w] + v > dp[j]) {
        dp[j] = dp[j - w] + v;
        chosen[i][j] = true;
      }
    }
  }

  let remW = W;
  const rawPicks = [];
  for (let i = N - 1; i >= 0; i--) {
    if (chosen[i][remW]) {
      rawPicks.push(items[i]);
      remW -= weights[i];
    }
  }

  const costTime = performance.now() - start;
  return {
    rawPicks,
    initialVal: dp[W],
    timeUs: (costTime * 1000).toFixed(1)
  };
}

export function runGreedyFair(bundles, allTasks, limitHours) {
  const start = performance.now();
  const sorted = [...bundles].map(b => ({
    ...b,
    density: Number(b.weight) / Number(b.hours)
  })).sort((a, b) => b.density - a.density);

  const selectedTaskIds = new Set();
  let currentHours = 0;
  let totalVal = 0;
  const chosenBundles = [];

  for (const bundle of sorted) {
    const neededNewIds = bundle.bundledTaskIds.filter(id => !selectedTaskIds.has(id));
    const extraHours = neededNewIds.reduce((sum, id) => sum + Number(allTasks.find(t => t.id === id).hours), 0);
    const extraWeight = neededNewIds.reduce((sum, id) => sum + Number(allTasks.find(t => t.id === id).weight), 0);

    if (currentHours + extraHours <= limitHours && neededNewIds.length > 0) {
      neededNewIds.forEach(id => selectedTaskIds.add(id));
      currentHours += extraHours;
      totalVal += extraWeight;
      chosenBundles.push(bundle);
    }
  }

  const costTime = performance.now() - start;
  return {
    picks: chosenBundles,
    totalVal,
    usedHours: currentHours,
    timeUs: (costTime * 1000).toFixed(1)
  };
}