# Wand FX — OBS／VTube Studio 魔杖粒子原型

這是一個零依賴的透明 OBS Browser Source。它使用 VTube Studio Public Beta 的 `ArtMeshTrackingEvent` 追蹤魔杖尖端，並監聽 VTS 內建控制器輸入與 hotkey。

效果展示
--------

[YouTube](https://www.youtube.com/watch?v=P9PNtyZeeXQ)

事前準備
--------
1. 安裝支援 ArtMeshTrackingEvent 的 VTube Studio。 (目前是 Beta 版)
2. 在 VTube Studio 中點選齒輪，向下找到「開啟 API（允許外掛程式）」，將它打開，埠號維持 8001 即可。
3. 解壓縮下載的 WandFX。

加入 OBS
-------
1. 打開 VTube Studio。
2. 將 index.html 直接拖進 OBS。
  1. 有些舊版 OBS 似乎不支援，那麼可以改為新增瀏覽器來源，選擇使用本機檔案，再選擇 index.html。
3. 將新增的瀏覽器來源的寬度與高度，設為和 VTube Studio 畫質及特效中設定的解析度一樣。
4. 在 OBS 中，瀏覽器來源的縮放和位置必須與 VTube Studio 來源一致（提示：可使用複製/貼上變換）。

第一次連線與校正
----------------
1. OBS 會讓 Wand FX 連接 VTube Studio。
2. VTube Studio 跳出外掛程式要求存取 API 詢問時按允許。
3. 此時 OBS 上的 WandFX 面板右上方應該會顯示「已連線」。
3. 選擇瀏覽器來源，點擊「互動」。
5. 按「開始校正杖尖」。
6. 切換到 VTube Studio，直接點擊模型上的魔杖尖端，成功後會看到深紅色圈圈。
7. 回 OBS 的互動視窗，確認顯示「追蹤中」。
8. 按「顯示追蹤：開」，就會將深紅色圈圈隱藏。
9. 按「隱藏設定面板」，畫面便只剩透明特效。
10. 若需要重新校正，可重新整理瀏覽器來源，面板就會重新出現。

按鍵效果
--------
- ControllerSquare（X／□）：藍色空心方塊
- ControllerTriangle（Y／△）：黃色空心三角形
- ControllerCross（A／×）：綠色叉叉
- ControllerCircle（B／○）：紅色空心圓圈

按下會生成符號；按住會畫發光軌跡，持續按住會集氣，放開後爆散。

常見問題
--------
完全沒有反應：
- 確認 VTube Studio 使用的是 vts_public_beta 版本。
- 確認 VTube Studio 已開啟 Allow Plugin API access。
- 確認 VTS 中已允許 Wand FX。
- 在 OBS 重新整理瀏覽器來源。

位置偏移：
- 確認瀏覽器來源和 VTS 擷取的解析度、位置、縮放與裁切完全相同。

重新校正：
- 在 OBS 右鍵來源選「互動」，按「重新校正杖尖」。

請勿移動或刪除以下檔案：
- index.html
- app.js
- styles.css

這三個檔案必須放在同一個資料夾。

License
-------
The MIT License
