(() => {
  "use strict";

  const API_NAME = "VTubeStudioPublicAPI";
  const API_VERSION = "1.0";
  const PLUGIN_NAME = "Wand FX";
  const PLUGIN_DEVELOPER = "水無月悠歌 minazukitouka";
  const TOKEN_KEY = "wand-fx-vts-token";
  const WAND_TIP_KEY = "wand-fx-wand-tip";
  const SIZE_SETTINGS_PREFIX = "wand-fx-size-";
  const TRACKING_POINT_ID = "wand-fx-wand-tip";

  const EFFECTS = {
    Wand_Yellow: { label: "A · ×", color: "#43c66b", glow: "#adf5c1", shape: "cross", hollow: true },
    Wand_Blue:   { label: "B · ○", color: "#ef4050", glow: "#ff9ba5", shape: "circle", hollow: true },
    Wand_Pink:   { label: "X · □", color: "#438ee8", glow: "#add5ff", shape: "square", hollow: true },
    Wand_Green:  { label: "Y · △", color: "#f2c744", glow: "#fff0a6", shape: "triangle", hollow: true }
  };

  const CONTROLLER_INPUTS = {
    ControllerCross: EFFECTS.Wand_Yellow,
    ControllerCircle: EFFECTS.Wand_Blue,
    ControllerSquare: EFFECTS.Wand_Pink,
    ControllerTriangle: EFFECTS.Wand_Green
  };
  const HOLD_TO_CHARGE_MS = 450;
  const TRAIL_LIFE_MS = 420;

  const canvas = document.querySelector("#fx");
  const ctx = canvas.getContext("2d");
  const panel = document.querySelector("#panel");
  const status = document.querySelector("#status");
  const endpoint = document.querySelector("#endpoint");
  const marker = document.querySelector("#marker");
  const calibrateButton = document.querySelector("#calibrate");
  const calibrationStatus = document.querySelector("#calibration-status");
  const diagnostics = document.querySelector("#diagnostics");
  const effectScaleInput = document.querySelector("#effect-scale");
  const effectScaleValue = document.querySelector("#effect-scale-value");
  const sizeStatus = document.querySelector("#size-status");
  const panelTabs = [...document.querySelectorAll(".panel-tab")];
  const tabPanels = [...document.querySelectorAll(".tab-panel")];
  const controllerDebugElements = {
    ControllerCross: document.querySelector("#controller-debug-cross"),
    ControllerCircle: document.querySelector("#controller-debug-circle"),
    ControllerSquare: document.querySelector("#controller-debug-square"),
    ControllerTriangle: document.querySelector("#controller-debug-triangle")
  };

  let width = 1;
  let height = 1;
  let dpr = 1;
  let socket = null;
  let reconnectTimer = null;
  let manualDisconnect = false;
  let requestCounter = 0;
  let charging = false;
  let chargeStarted = 0;
  let nextChargeParticle = 0;
  let activeChargeEffect = EFFECTS.Wand_Blue;
  let wandTipConfig = loadWandTipConfig();
  let wandTip = { x: .5, y: .5, rotation: 0, size: 1, tracked: false };
  let referenceTrackingSize = 0;
  let personalEffectScale = 1;
  let sizePreviewUntil = 0;
  let awaitingCalibrationClick = false;
  let modelClickCount = 0;
  let trailStrokeID = 0;
  let controllerPollTimer = null;
  let controllerPollInFlight = false;
  let lastControllerAvailableCount = -1;
  const pending = new Map();
  const particles = [];
  const trailPoints = [];
  const controllerStates = Object.fromEntries(
    Object.keys(CONTROLLER_INPUTS).map(name => [name, { pressed: false, pressedAt: 0, charging: false }])
  );

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function origin() {
    return { x: wandTip.x * width, y: wandTip.y * height };
  }

  function loadWandTipConfig() {
    try { return JSON.parse(localStorage.getItem(WAND_TIP_KEY)) || null; }
    catch { return null; }
  }

  function sizeSettingsKey(modelID = wandTipConfig?.modelID) {
    return modelID ? `${SIZE_SETTINGS_PREFIX}${modelID}` : null;
  }

  function loadSizeSettings(modelID = wandTipConfig?.modelID) {
    const key = sizeSettingsKey(modelID);
    let settings = null;
    try { settings = key ? JSON.parse(localStorage.getItem(key)) : null; } catch {}
    referenceTrackingSize = Number(settings?.referenceTrackingSize) || 0;
    personalEffectScale = Number(settings?.personalEffectScale) || 1;
    effectScaleInput.value = String(Math.round(personalEffectScale * 100));
    effectScaleValue.textContent = `${effectScaleInput.value}%`;
    sizeStatus.textContent = referenceTrackingSize
      ? `尺寸基準：${referenceTrackingSize.toFixed(4)} · 個人倍率 ${effectScaleInput.value}%`
      : "尚未設定尺寸基準";
  }

  function saveSizeSettings() {
    const key = sizeSettingsKey();
    if (key) localStorage.setItem(key, JSON.stringify({ referenceTrackingSize, personalEffectScale }));
  }

  function currentEffectScale() {
    const trackingRatio = referenceTrackingSize > 0 && wandTip.size > 0
      ? Math.min(3, Math.max(.35, wandTip.size / referenceTrackingSize))
      : 1;
    return trackingRatio * personalEffectScale;
  }

  function updateCalibrationStatus(text) {
    calibrationStatus.textContent = text;
  }

  function markerIsVisible() {
    return marker.getAttribute("aria-pressed") === "true";
  }

  function setMarkerVisible(visible, resubscribe = true) {
    marker.setAttribute("aria-pressed", String(visible));
    marker.textContent = `顯示追蹤：${visible ? "開" : "關"}`;
    if (resubscribe) subscribeWandTipTracking();
  }

  function selectPanelTab(tabName) {
    panelTabs.forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.tabTarget === tabName)));
    tabPanels.forEach(tabPanel => { tabPanel.hidden = tabPanel.dataset.tabPanel !== tabName; });
    localStorage.setItem("wand-fx-panel-tab", tabName);
  }

  function showClickDiagnostics(data) {
    modelClickCount++;
    const hits = data?.artMeshHits || [];
    diagnostics.textContent = [
      `VTS 點擊事件：${modelClickCount}`,
      `命中模型：${data?.modelWasClicked ? "是" : "否"}`,
      `ArtMesh 數量：${hits.length}`,
      `最上層 ArtMesh：${hits[0]?.hitInfo?.artMeshID || "—"}`,
      `位置：${data?.clickPosition ? `${data.clickPosition.x.toFixed(3)}, ${data.clickPosition.y.toFixed(3)}` : "—"}`
    ].join("\n");
  }

  function setTrackingPosition(position, rotation = 0, size = 1) {
    // VTS: (-1,-1) 左下、(1,1) 右上；Canvas: (0,0) 左上。
    wandTip.x = (Number(position.x) + 1) / 2;
    wandTip.y = (1 - Number(position.y)) / 2;
    wandTip.rotation = Number(rotation) || 0;
    wandTip.size = Number(size) || 1;
    wandTip.tracked = true;
  }

  function random(min, max) { return min + Math.random() * (max - min); }

  function heldControllerEffect() {
    let latest = null;
    for (const [name, state] of Object.entries(controllerStates)) {
      if (state.pressed && (!latest || state.pressedAt > latest.pressedAt)) {
        latest = { pressedAt: state.pressedAt, effect: CONTROLLER_INPUTS[name] };
      }
    }
    return latest?.effect || null;
  }

  function recordTrailPoint(now) {
    const effect = heldControllerEffect();
    if (!effect || !wandTip.tracked) return;
    const o = origin();
    const previous = trailPoints[trailPoints.length - 1];
    const distance = previous ? Math.hypot(o.x - previous.x, o.y - previous.y) : Infinity;
    if (previous && distance < 1.5 && now - previous.born < 30) return;
    trailPoints.push({ x: o.x, y: o.y, born: now, color: effect.color, glow: effect.glow, strokeID: trailStrokeID, scale: currentEffectScale() });
  }

  function renderTrail(now) {
    while (trailPoints.length && now - trailPoints[0].born > TRAIL_LIFE_MS) trailPoints.shift();
    if (trailPoints.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "lighter";
    const newest = trailPoints[trailPoints.length - 1];

    // 將同一筆畫合成一條平滑路徑，避免每小段各自套用昂貴的陰影效果。
    const drawPath = () => {
      ctx.beginPath();
      let activeStroke = null;
      for (let i = 0; i < trailPoints.length; i++) {
        const point = trailPoints[i];
        if (point.strokeID !== activeStroke) {
          activeStroke = point.strokeID;
          ctx.moveTo(point.x, point.y);
          continue;
        }
        const next = trailPoints[i + 1];
        if (next && next.strokeID === activeStroke) {
          ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }
    };

    drawPath();
    ctx.strokeStyle = newest.color;
    ctx.globalAlpha = .58;
    ctx.lineWidth = 10 * (newest.scale || 1);
    ctx.shadowColor = newest.glow;
    ctx.shadowBlur = 12 * (newest.scale || 1);
    ctx.stroke();

    drawPath();
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = .62;
    ctx.lineWidth = 2.2 * (newest.scale || 1);
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
  }

  function spawn(effect, amount = 1, charged = false) {
    const o = origin();
    const effectScale = currentEffectScale();
    for (let i = 0; i < amount; i++) {
      const life = random(720, 1150);
      const angle = random(0, Math.PI * 2);
      const speed = (charged ? random(45, 105) : random(12, 42)) * effectScale;
      particles.push({
        kind: "burst",
        shape: effect.shape,
        hollow: effect.hollow,
        color: effect.color,
        glow: effect.glow,
        x: o.x + random(-18, 18) * effectScale,
        y: o.y + random(-18, 18) * effectScale,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - random(4, 18),
        rotation: random(0, Math.PI * 2),
        spin: random(-5.5, 5.5),
        size: random(13, 26) * (charged ? 1.25 : 1) * effectScale,
        born: performance.now(),
        life
      });
    }
  }

  function spawnChargeBubble(now) {
    const o = origin();
    const effectScale = currentEffectScale();
    const age = Math.min((now - chargeStarted) / 1800, 1);
    const angle = random(0, Math.PI * 2);
    const radius = random(70, 145) * (1 - age * .2) * effectScale;
    particles.push({
      kind: "charge",
      color: activeChargeEffect.color,
      glow: activeChargeEffect.glow,
      x: o.x + Math.cos(angle) * radius,
      y: o.y + Math.sin(angle) * radius,
      rotation: angle,
      spin: random(-2, 2),
      size: random(4, 11) * effectScale,
      born: now,
      life: random(420, 760)
    });
  }

  function pathShape(shape, size) {
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(0, 0, size * .78, 0, Math.PI * 2);
    } else if (shape === "square") {
      const side = size * 1.35;
      ctx.rect(-side / 2, -side / 2, side, side);
    } else if (shape === "triangle") {
      ctx.moveTo(0, -size * .88);
      ctx.lineTo(size * .82, size * .62);
      ctx.lineTo(-size * .82, size * .62);
      ctx.closePath();
    } else if (shape === "cross") {
      const arm = size * .72;
      ctx.moveTo(-arm, -arm); ctx.lineTo(arm, arm);
      ctx.moveTo(arm, -arm); ctx.lineTo(-arm, arm);
    } else if (shape === "diamond") {
      ctx.moveTo(0, -size); ctx.lineTo(size * .66, 0); ctx.lineTo(0, size); ctx.lineTo(-size * .66, 0); ctx.closePath();
    } else if (shape === "heart") {
      const s = size / 16;
      ctx.moveTo(0, 6 * s);
      ctx.bezierCurveTo(-14*s, -3*s, -8*s, -13*s, 0, -7*s);
      ctx.bezierCurveTo(8*s, -13*s, 14*s, -3*s, 0, 6*s);
      ctx.closePath();
    } else if (shape === "spark") {
      ctx.moveTo(0, -size); ctx.lineTo(size*.18, -size*.18); ctx.lineTo(size, 0);
      ctx.lineTo(size*.18, size*.18); ctx.lineTo(0, size); ctx.lineTo(-size*.18, size*.18);
      ctx.lineTo(-size, 0); ctx.lineTo(-size*.18, -size*.18); ctx.closePath();
    } else {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const r = i % 2 ? size * .43 : size;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
  }

  function renderParticle(p, now) {
    const t = Math.min((now - p.born) / p.life, 1);
    const dt = Math.min((now - p.born) / 1000, 2);
    const o = origin();
    let x;
    let y;
    let scale;
    let alpha;

    if (p.kind === "charge") {
      const ease = 1 - Math.pow(1 - t, 3);
      x = p.x + (o.x - p.x) * ease;
      y = p.y + (o.y - p.y) * ease;
      scale = .7 + Math.sin(t * Math.PI) * .7;
      alpha = Math.sin(t * Math.PI);
    } else {
      x = p.x + p.vx * dt;
      y = p.y + p.vy * dt + 32 * dt * dt;
      // 第一幀就清楚可見，避免按下後有「慢慢長出來」的感覺。
      scale = .78 + Math.sin(Math.min(t * 1.35, 1) * Math.PI) * .62;
      alpha = 1 - Math.pow(t, 2.2);
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.rotation + p.spin * dt);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = p.glow;
    ctx.shadowBlur = 15;

    if (p.kind === "charge") {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      pathShape(p.shape, p.size);
      if (p.hollow) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(3.2, p.size * .18);
        ctx.stroke();
        ctx.globalAlpha *= .52;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.15;
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.globalAlpha *= .7;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function renderChargeCore(now) {
    if (!charging) return;
    const o = origin();
    const level = Math.min((now - chargeStarted) / 2200, 1);
    const pulse = 1 + Math.sin(now / 85) * (.05 + level * .07);
    const radius = (12 + level * 34) * pulse * currentEffectScale();
    const gradient = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, radius * 2.2);
    gradient.addColorStop(0, "rgba(255,255,255,.98)");
    gradient.addColorStop(.25, activeChargeEffect.glow);
    gradient.addColorStop(.55, activeChargeEffect.color + "aa");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(o.x, o.y, radius * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function frame(now) {
    ctx.clearRect(0, 0, width, height);

    if (charging) {
      const level = Math.min((now - chargeStarted) / 2200, 1);
      if (now >= nextChargeParticle) {
        spawnChargeBubble(now);
        nextChargeParticle = now + random(35, 105) * (1 - level * .55);
      }
    }

    renderTrail(now);

    for (let i = particles.length - 1; i >= 0; i--) {
      if (now - particles[i].born >= particles[i].life) particles.splice(i, 1);
      else renderParticle(particles[i], now);
    }
    renderChargeCore(now);

    if (now < sizePreviewUntil && wandTip.tracked) {
      const o = origin();
      const previewScale = currentEffectScale();
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "#f2c744";
      ctx.lineWidth = Math.max(3, 5 * previewScale);
      ctx.shadowColor = "#fff0a6";
      ctx.shadowBlur = 18 * previewScale;
      ctx.beginPath();
      ctx.arc(0, 0, 34 * previewScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (markerIsVisible() && !document.body.classList.contains("overlay")) {
      const o = origin();
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(o.x, o.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(o.x - 14, o.y); ctx.lineTo(o.x + 14, o.y); ctx.moveTo(o.x, o.y - 14); ctx.lineTo(o.x, o.y + 14); ctx.stroke();
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }

  function startCharge(effect = EFFECTS.Wand_Blue) {
    if (charging) return;
    charging = true;
    activeChargeEffect = effect;
    chargeStarted = performance.now();
    nextChargeParticle = chargeStarted;
  }

  function releaseCharge() {
    if (!charging) return;
    const level = Math.min((performance.now() - chargeStarted) / 2200, 1);
    charging = false;
    spawn(activeChargeEffect, Math.round(5 + level * 15), true);
  }

  function updateControllerInput(name, value, now) {
    const state = controllerStates[name];
    const effect = CONTROLLER_INPUTS[name];
    const pressed = Number(value) > 0.5;

    if (pressed && !state.pressed) {
      state.pressed = true;
      state.pressedAt = now;
      state.charging = false;
      trailStrokeID++;
      spawn(effect);
      return;
    }

    if (pressed && !state.charging && now - state.pressedAt >= HOLD_TO_CHARGE_MS) {
      // 同一時間只保留一個集氣核心；新的按鍵會接管顏色。
      if (charging) releaseCharge();
      state.charging = true;
      startCharge(effect);
      return;
    }

    if (!pressed && state.pressed) {
      state.pressed = false;
      if (state.charging) releaseCharge();
      state.charging = false;
    }
  }

  function updateControllerDebug(name, result) {
    const card = controllerDebugElements[name];
    if (!card) return;
    const detail = card.querySelector("small");
    if (result.status !== "fulfilled") {
      card.dataset.state = "missing";
      detail.textContent = "找不到參數";
      return;
    }
    const value = Number(result.value.data?.value) || 0;
    const pressed = value > .5;
    card.dataset.state = pressed ? "active" : "ready";
    detail.textContent = pressed ? `已按下 · ${value.toFixed(2)}` : `已收到 · ${value.toFixed(2)}`;
  }

  async function pollControllerInputs() {
    if (controllerPollInFlight || !socket || socket.readyState !== WebSocket.OPEN) return;
    controllerPollInFlight = true;
    const now = performance.now();
    try {
      const names = Object.keys(CONTROLLER_INPUTS);
      const results = await Promise.allSettled(
        names.map(name => send("ParameterValueRequest", { name }, 1000))
      );
      const availableCount = results.filter(result => result.status === "fulfilled").length;
      if (availableCount !== lastControllerAvailableCount) {
        lastControllerAvailableCount = availableCount;
        setStatus(
          availableCount
            ? `已連線：控制器輸入 ${availableCount}/${names.length}`
            : "已連線：找不到控制器輸入，Hotkey 仍可用",
          "online"
        );
      }
      results.forEach((result, index) => {
        updateControllerDebug(names[index], result);
        if (result.status === "fulfilled") updateControllerInput(names[index], result.value.data?.value, now);
      });
    } finally {
      controllerPollInFlight = false;
    }
  }

  function startControllerPolling() {
    clearInterval(controllerPollTimer);
    // 按鈕狀態不需要跟座標一樣跑到 60 FPS；降低 API/CEF 負擔。
    controllerPollTimer = setInterval(pollControllerInputs, 35);
    pollControllerInputs();
  }

  async function subscribeWandTipTracking() {
    if (!wandTipConfig) {
      updateCalibrationStatus("尚未校正。從 OBS 的「互動」按下校正，再到 VTS 點擊魔杖尖端。");
      return;
    }

    try {
      await send("EventSubscriptionRequest", {
        eventName: "ArtMeshTrackingEvent",
        subscribe: true,
        config: {
          frequency: 60,
          trackingPoints: [{
            trackingPointID: TRACKING_POINT_ID,
            artMeshCoords: wandTipConfig,
            visualize: markerIsVisible()
          }]
        }
      });
      updateCalibrationStatus(`追蹤中：${wandTipConfig.artMeshID}`);
      diagnostics.textContent = `Beta 追蹤訂閱成功\nArtMesh：${wandTipConfig.artMeshID}\n等待第一筆 60 FPS 座標…`;
    } catch (error) {
      updateCalibrationStatus(`無法啟用 Beta 追蹤：${error.message}`);
    }
  }

  async function beginCalibration() {
    awaitingCalibrationClick = true;
    calibrateButton.textContent = "等待點擊杖尖…";
    updateCalibrationStatus("校正等待中：切換到 VTube Studio，直接點擊模型上的魔杖尖端。");
  }

  async function saveCalibrationFromClick(data) {
    if (!awaitingCalibrationClick || !data?.modelWasClicked || !data.artMeshHits?.length) return;
    awaitingCalibrationClick = false;
    calibrateButton.textContent = "重新校正杖尖";
    const hit = data.artMeshHits[0].hitInfo;
    wandTipConfig = {
      modelID: hit.modelID,
      artMeshID: hit.artMeshID,
      vertexID1: hit.vertexID1,
      vertexID2: hit.vertexID2,
      vertexID3: hit.vertexID3,
      vertexWeight1: hit.vertexWeight1,
      vertexWeight2: hit.vertexWeight2,
      vertexWeight3: hit.vertexWeight3,
      angle: 0,
      size: 1
    };
    localStorage.setItem(WAND_TIP_KEY, JSON.stringify(wandTipConfig));
    loadSizeSettings(wandTipConfig.modelID);
    // 新的 ArtMesh 點可能有不同的三角形尺寸；由下一筆追蹤資料自動建立新基準。
    referenceTrackingSize = 0;
    saveSizeSettings();
    sizeStatus.textContent = "等待第一筆杖尖追蹤資料以建立尺寸基準…";
    setTrackingPosition(data.clickPosition);
    updateCalibrationStatus(`已記錄：${wandTipConfig.artMeshID}，正在啟用追蹤…`);
    await subscribeWandTipTracking();
  }

  function setStatus(text, state = "offline") {
    status.textContent = text;
    status.dataset.state = state;
  }

  function envelope(messageType, data = {}) {
    return {
      apiName: API_NAME,
      apiVersion: API_VERSION,
      requestID: `trail-${Date.now()}-${++requestCounter}`,
      messageType,
      data
    };
  }

  function send(messageType, data = {}, timeout = 10000) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("VTS 尚未連線"));
    const message = envelope(messageType, data);
    socket.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.requestID);
        reject(new Error(`${messageType} 等候逾時`));
      }, timeout);
      pending.set(message.requestID, { resolve, reject, timer });
    });
  }

  async function authenticate() {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus("請在 VTS 允許 Plugin", "pending");
      const response = await send("AuthenticationTokenRequest", {
        pluginName: PLUGIN_NAME,
        pluginDeveloper: PLUGIN_DEVELOPER
      }, 60000);
      token = response.data.authenticationToken;
      localStorage.setItem(TOKEN_KEY, token);
    }

    let response = await send("AuthenticationRequest", {
      pluginName: PLUGIN_NAME,
      pluginDeveloper: PLUGIN_DEVELOPER,
      authenticationToken: token
    });

    if (!response.data.authenticated) {
      localStorage.removeItem(TOKEN_KEY);
      throw new Error(response.data.reason || "VTS 認證失敗，請重新連線");
    }

    await send("EventSubscriptionRequest", {
      eventName: "HotkeyTriggeredEvent",
      subscribe: true,
      config: { ignoreHotkeysTriggeredByAPI: false }
    });
    await send("EventSubscriptionRequest", {
      eventName: "ModelClickedEvent",
      subscribe: true,
      // 監聽整個 VTS 視窗，校正失敗時能分辨「沒收到點擊」和「沒點到模型」。
      config: { onlyClicksOnModel: false }
    });
    await subscribeWandTipTracking();
    startControllerPolling();
    setStatus("已連線：NP 按鈕 + Hotkey", "online");
  }

  function handleMessage(event) {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }

    if (message.requestID && pending.has(message.requestID)) {
      const task = pending.get(message.requestID);
      pending.delete(message.requestID);
      clearTimeout(task.timer);
      if (message.messageType === "APIError") task.reject(new Error(message.data?.message || "VTS API 錯誤"));
      else task.resolve(message);
      return;
    }

    if (message.messageType === "HotkeyTriggeredEvent") {
      const effect = EFFECTS[message.data?.hotkeyName];
      if (effect) spawn(effect);
    }
    if (message.messageType === "ModelClickedEvent") {
      showClickDiagnostics(message.data);
      if (awaitingCalibrationClick && !message.data?.modelWasClicked) {
        updateCalibrationStatus("有收到點擊，但沒有命中模型 ArtMesh；請再點一次魔杖可見圖層的內側。");
      }
      saveCalibrationFromClick(message.data).catch(error => updateCalibrationStatus(error.message));
    }
    if (message.messageType === "ArtMeshTrackingEvent") {
      const point = message.data?.trackingPoints?.find(item => item.trackingPointID === TRACKING_POINT_ID);
      if (point) {
        setTrackingPosition(point.position, point.rotation, point.size);
        if (!referenceTrackingSize && wandTip.size > 0 && wandTipConfig) {
          referenceTrackingSize = wandTip.size;
          saveSizeSettings();
          sizePreviewUntil = performance.now() + 1800;
          sizeStatus.textContent = `已自動保存尺寸基準：${referenceTrackingSize.toFixed(4)} · 個人倍率 ${effectScaleInput.value}%`;
        }
        recordTrailPoint(performance.now());
        updateCalibrationStatus(`追蹤中：${wandTipConfig?.artMeshID || "杖尖"} · 60 FPS`);
        diagnostics.textContent = [
          "Beta 追蹤資料：正常",
          `ArtMesh：${wandTipConfig?.artMeshID || "—"}`,
          `VTS 座標：${point.position.x.toFixed(3)}, ${point.position.y.toFixed(3)}`,
          `旋轉：${point.rotation.toFixed(1)}°`,
          `目前尺寸：${Number(point.size).toFixed(5)}`,
          `校正基準：${referenceTrackingSize ? referenceTrackingSize.toFixed(5) : "未設定"}`,
          `最終倍率：${currentEffectScale().toFixed(2)}×`,
          `可見：${point.artMeshVisible ? "是" : "否"}`
        ].join("\n");
      } else if (message.data?.modelLoaded) {
        wandTip.tracked = false;
        updateCalibrationStatus("已連線，但目前模型找不到校正的 ArtMesh 點。");
      }
    }
  }

  function connect() {
    manualDisconnect = false;
    clearTimeout(reconnectTimer);
    if (socket) socket.close();
    localStorage.setItem("wand-fx-vts-endpoint", endpoint.value.trim());
    setStatus("連線中…", "pending");
    socket = new WebSocket(endpoint.value.trim());
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("open", () => authenticate().catch(error => setStatus(error.message)));
    socket.addEventListener("error", () => setStatus("無法連接 VTS"));
    socket.addEventListener("close", () => {
      clearInterval(controllerPollTimer);
      controllerPollTimer = null;
      controllerPollInFlight = false;
      lastControllerAvailableCount = -1;
      for (const state of Object.values(controllerStates)) {
        state.pressed = false;
        state.charging = false;
      }
      charging = false;
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(new Error("VTS 連線中斷"));
      }
      pending.clear();
      setStatus("連線中斷，準備重連");
      if (!manualDisconnect) reconnectTimer = setTimeout(connect, 3000);
    });
  }

  document.querySelector("#connect").addEventListener("click", connect);
  document.querySelector("#overlay").addEventListener("click", () => {
    document.body.classList.add("overlay");
    if (markerIsVisible()) setMarkerVisible(false);
  });
  document.querySelector("#show-panel").addEventListener("click", () => document.body.classList.remove("overlay"));
  calibrateButton.addEventListener("click", beginCalibration);
  document.querySelector("#clear-calibration").addEventListener("click", async () => {
    awaitingCalibrationClick = false;
    wandTipConfig = null;
    wandTip.tracked = false;
    localStorage.removeItem(WAND_TIP_KEY);
    calibrateButton.textContent = "開始校正杖尖";
    updateCalibrationStatus("校正已清除。");
    if (socket?.readyState === WebSocket.OPEN) {
      await send("EventSubscriptionRequest", {
        eventName: "ArtMeshTrackingEvent",
        subscribe: false,
        config: {}
      }).catch(() => {});
    }
  });
  marker.addEventListener("click", () => setMarkerVisible(!markerIsVisible()));
  panelTabs.forEach(tab => tab.addEventListener("click", () => selectPanelTab(tab.dataset.tabTarget)));
  effectScaleInput.addEventListener("input", () => {
    personalEffectScale = Number(effectScaleInput.value) / 100;
    effectScaleValue.textContent = `${effectScaleInput.value}%`;
    saveSizeSettings();
    sizePreviewUntil = performance.now() + 900;
    sizeStatus.textContent = referenceTrackingSize
      ? `尺寸基準：${referenceTrackingSize.toFixed(4)} · 個人倍率 ${effectScaleInput.value}%`
      : `個人倍率 ${effectScaleInput.value}% · 尚未設定尺寸基準`;
  });

  endpoint.value = localStorage.getItem("wand-fx-vts-endpoint") || endpoint.value;
  if (wandTipConfig) {
    calibrateButton.textContent = "重新校正杖尖";
    updateCalibrationStatus(`已載入校正：${wandTipConfig.artMeshID}，等待 VTS 連線…`);
  }
  loadSizeSettings();
  selectPanelTab(localStorage.getItem("wand-fx-panel-tab") || "settings");
  if (new URLSearchParams(location.search).has("overlay")) {
    document.body.classList.add("overlay");
    setMarkerVisible(false, false);
  }

  addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);

  // 延遲連線，讓 VTS Web Item 完成初始化；一般瀏覽器預覽時不會阻塞畫面。
  setTimeout(connect, 400);
})();
