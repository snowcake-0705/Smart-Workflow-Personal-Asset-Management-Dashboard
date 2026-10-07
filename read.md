# Edge-Native Personal Resource Optimization Engine
> 基於邊緣計算之個人資源調度與非參數統計決策系統

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Storage](https://img.shields.io/badge/Storage-IndexedDB%20(B--Tree)-green.svg)]()
[![Algorithms](https://img.shields.io/badge/Algorithms-Kahn's%20DAG%20%7C%200%2F1%20Knapsack%20DP%20%7C%20Rolling%20IQR-orange.svg)]()

## 📌 專案背景與核心定位

現代個人資料管理工具多依賴雲端中心化伺服器，使高度機敏的金流與日常行程暴露於隱私外洩風險。此外，傳統待辦工具缺乏圖論約束與運籌求解能力，無法在「工時受限」與「任務具前置依賴」情境下求得效用最佳解。

本專案定位為 **Edge-Native Zero-Knowledge Prototype（邊緣原生零知識決策原型）**：
1. **零雲端依賴**：完全在瀏覽器端運行，保護高機敏個人隱私數據。
2. **圖論相依與運籌決策**：以 Kahn's Algorithm 阻斷循環死結，並透過相依閉包啟發式動態規劃（Closure Heuristic DP）進行排程最佳化。
3. **概念漂移防護**：以 IndexedDB B-Tree 索引實現 30 天滾動窗口分層 IQR（Rolling Stratified IQR），有效濾除離群衝動消費。

---

## 📐 數學模型與問題定義

### 1. 帶相依約束之背包排程問題 (Precedence-Constrained Knapsack Problem)
給定任務集合 $V = \{1, 2, \dots, n\}$，其相依關係構成有向無環圖 $G = (V, E)$：
* **目標函數 (Objective)**：
  $$\max \sum_{i \in S} w_i$$
* **約束條件 (Constraints)**：
  $$\sum_{i \in S} h_i \le H \quad (\text{工時上限})$$
  $$\forall v \in S, \quad (u, v) \in E \implies u \in S \cup C_{\text{done}} \quad (\text{前置相依約束})$$
  *(其中 $w_i$ 為任務效益權重，$h_i$ 為工時，$H$ 為可用工時上限，$C_{\text{done}}$ 為歷史已完成任務)*

### 2. 滾動窗口分層四分位距檢定 (Rolling Stratified IQR)
針對特定分類 $c$ 之近 30 日支出序列 $D_{c, t}$：
$$\mathcal{T}(x) = \begin{cases}  \text{Anomaly (衝動消費預警)}, & \text{if } x > Q_3 + 1.5 \times \text{IQR} \\  \text{Normal (常態支出)}, & \text{otherwise}  \end{cases}$$
若樣本不足（$\vert{}D_{c, t}\vert{} < 4$），啟動自適應回退（Adaptive Fallback）機制降級為歷史全期分層基準，避免冷啟動失靈。

---

## 🔬 實證消融實驗 (Ablation Benchmark)

在 Chrome V8 Runtime 實機量測不同任務規模下的演算法表現（工時上限 $H=8\text{h}$）：

| 任務數量 ($N$) | 相依邊數 ($\vert{}E\vert{}$) | Kahn 拓撲排序耗時 | 閉包 DP 總效益 | 閉包 DP 耗時 | 貪婪法總效益 | 貪婪法耗時 | 近似比 (Ratio) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **5** | 2 | $12.4\ \mu s$ | **9** | $34.1\ \mu s$ | **9** | $14.2\ \mu s$ | **1.000 (100%)** |
| **10** | 5 | $18.7\ \mu s$ | **14** | $62.8\ \mu s$ | **12** | $21.5\ \mu s$ | **0.857 (85.7%)** |
| **20** | 12 | $31.2\ \mu s$ | **21** | $118.5\ \mu s$ | **18** | $38.9\ \mu s$ | **0.857 (85.7%)** |
| **50** | 35 | $74.5\ \mu s$ | **38** | $285.4\ \mu s$ | **31** | $82.1\ \mu s$ | **0.816 (81.6%)** |

> **實驗洞察**：在離散約束下，貪婪啟發式隨著維度擴增會損失 14% 至 18% 邊際效用；而動態規劃在 $N=50$ 規模下耗時僅 $285\ \mu s$，證明邊緣端主執行緒具備零延遲求解能力。

---

## 🛠️ 系統模組架構

```text
my-portfolio-project/
├── index.html          # View: 視圖呈現、進度條視覺化與評測儀
├── css/
│   └── style.css       # Layout & Components
└── js/
    ├── core.js         # Model: IndexedDB、Kahn's Algo、Knapsack DP、Rolling IQR
    └── app.js          # Controller: 業務流程、事件處理與視圖綁定 
