(() => {
  if (window.__WEBGL_HUD_MOUNTED__) return;
  window.__WEBGL_HUD_MOUNTED__ = true;

  // Mặc định ẩn HUD, chỉ mở khi người dùng click vào icon extension
  let isVisible = false;
  let isCollapsed = false;
  let showScenePanel = false;
  let wireframeOn = false;
  let activeContextId = null;
  let latestPayload = null;
  let hostEl = null;
  let shadowRoot = null;

  const mountHUD = () => {
    if (hostEl) return;
    hostEl = document.createElement("div");
    hostEl.id = "webgl-perf-inspector-host";
    hostEl.style.cssText = "position: fixed; top: 16px; right: 16px; z-index: 2147483647; pointer-events: none;";
    document.documentElement.appendChild(hostEl);

    shadowRoot = hostEl.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .hud-card {
          pointer-events: auto;
          user-select: none;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          background: rgba(9, 9, 11, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.65);
          min-width: 280px;
          max-width: 345px;
          color: #e4e4e7;
          overflow: hidden;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 7px 10px;
          background: rgba(24, 24, 27, 0.92);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          cursor: grab;
          gap: 8px;
        }
        .header:active { cursor: grabbing; }
        .title-group { display: flex; align-items: center; gap: 6px; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; }
        .title { font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #d4d4d8; }
        .engine-badge {
          font-size: 9px; padding: 1px 5px; border-radius: 4px;
          background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 700;
        }
        .fps-group { display: flex; align-items: center; gap: 4px; }
        .fps-val { font-size: 11px; font-weight: 900; }
        .ms-val { font-size: 9.5px; color: #a1a1aa; }
        .btn-icon {
          background: transparent; border: none; color: #a1a1aa; cursor: pointer;
          padding: 2px 5px; border-radius: 4px; font-size: 11px; font-family: inherit;
        }
        .btn-icon:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
        .canvas-tabs {
          display: none;
          flex-wrap: wrap;
          gap: 4px;
          padding: 6px 8px;
          background: rgba(24, 24, 27, 0.55);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .canvas-tab {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #a1a1aa;
          font-size: 9.5px;
          padding: 3px 7px;
          border-radius: 5px;
          cursor: pointer;
          font-family: inherit;
          font-weight: 600;
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .canvas-tab:hover { background: rgba(255, 255, 255, 0.12); color: #e4e4e7; }
        .canvas-tab.active {
          background: rgba(56, 189, 248, 0.18);
          border-color: #38bdf8;
          color: #38bdf8;
        }
        .body { padding: 8px; display: flex; flex-direction: column; gap: 3px; font-size: 10px; }
        .section-tag {
          font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em;
          color: #71717a; font-weight: 700; padding: 4px 6px 1px;
        }
        .row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 2px 6px; border-radius: 4px;
        }
        .row:hover { background: rgba(255, 255, 255, 0.05); }
        .label { color: #a1a1aa; }
        .val { font-weight: 700; font-variant-numeric: tabular-nums; }
        .sky { color: #38bdf8; }
        .amber { color: #fbbf24; }
        .purple { color: #c084fc; }
        .emerald { color: #34d399; }
        .cyan { color: #22d3ee; }
        .rose { color: #fb7185; }
        .zinc { color: #d4d4d8; font-weight: 500; }
        .toolbar {
          display: flex; gap: 4px; padding: 6px 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(24, 24, 27, 0.6);
        }
        .tool-btn {
          flex: 1; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.1);
          color: #e4e4e7; font-size: 9.5px; padding: 4px 6px; border-radius: 6px;
          cursor: pointer; font-family: inherit; font-weight: 600;
        }
        .tool-btn:hover { background: rgba(255, 255, 255, 0.14); }
        .tool-btn.active { background: rgba(52, 211, 153, 0.2); border-color: #34d399; color: #34d399; }
        .scene-panel {
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding: 8px; font-size: 10px; background: rgba(0, 0, 0, 0.4);
        }
        .scene-summary {
          display: flex; flex-wrap: wrap; gap: 6px; justify-content: space-between;
          margin-bottom: 6px; padding-bottom: 5px;
          border-bottom: 1px dashed rgba(255,255,255,0.12); color: #a1a1aa; font-size: 9.5px;
        }
        .sub-heading {
          font-size: 9px; font-weight: 700; color: #fbbf24; margin: 4px 0 3px; text-transform: uppercase;
        }
        .tree-list { max-height: 135px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
        .tree-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 2px 5px; border-radius: 4px; background: rgba(255,255,255,0.03); gap: 6px;
        }
        .tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .tree-meta { color: #fbbf24; font-size: 9px; font-weight: 700; white-space: nowrap; }
        .vis-btn {
          background: none; border: none; color: #34d399; cursor: pointer; font-size: 10px; font-family: inherit;
        }
        .vis-btn.off { color: #71717a; opacity: 0.5; }
      </style>

      <div class="hud-card" id="card">
        <div class="header" id="drag-handle">
          <div class="title-group">
            <span class="dot"></span>
            <span class="title">Perf HUD</span>
            <span class="engine-badge" id="engine-badge">WebGL</span>
          </div>
          <div class="fps-group">
            <span class="fps-val emerald" id="fps">-- FPS</span>
            <span class="ms-val" id="ms">(--ms)</span>
            <button class="btn-icon" id="toggle-collapse" title="Thu gọn/Mở rộng">▲</button>
            <button class="btn-icon" id="close-hud" title="Đóng HUD">✕</button>
          </div>
        </div>

        <div class="canvas-tabs" id="canvas-tabs"></div>

        <div class="body" id="metrics-body">
          <div class="section-tag">Frame & GPU Timing</div>
          <div class="row" title="FPS thấp nhất ở nhóm 1% frame chậm nhất (bắt khựng micro-stutter)">
            <span class="label">1% Low / Spike</span>
            <span class="val emerald" id="low-fps">-- FPS / --ms</span>
          </div>
          <div class="row" title="Thời gian thực thi GPU qua WebGL2 Timer Query">
            <span class="label">GPU Render Time</span>
            <span class="val cyan" id="gpu-time">N/A</span>
          </div>

          <div class="section-tag">Draw Calls & Batching</div>
          <div class="row">
            <span class="label">Draw Calls</span>
            <span class="val sky" id="calls">0</span>
          </div>
          <div class="row" title="Trung bình số tam giác mỗi lần gọi vẽ (càng cao = batching càng tốt)">
            <span class="label">Triangles (Tris/Call)</span>
            <span class="val amber" id="triangles">0 (0)</span>
          </div>
          <div class="row" title="Số lần đổi Shader Program & số lần vẽ sang Offscreen FBO (Shadow/Mirror)">
            <span class="label">Shader Sw / FBO Pass</span>
            <span class="val zinc" id="state-switches">0 / 0</span>
          </div>

          <div class="section-tag">VRAM & Memory</div>
          <div class="row" title="Số lượng Texture & ước lượng dung lượng VRAM chiếm dụng">
            <span class="label">Textures (Est. VRAM)</span>
            <span class="val purple" id="textures">0 (0 MB)</span>
          </div>
          <div class="row" title="Số lượng Buffer hình học & dung lượng Vertex/Index Buffer">
            <span class="label">Geometries (Buffers)</span>
            <span class="val emerald" id="geometries">0 (0 MB)</span>
          </div>
          <div class="row">
            <span class="label">Compiled Shaders</span>
            <span class="val cyan" id="shaders">0</span>
          </div>
          <div class="row" title="Bộ nhớ JavaScript Heap hiện tại của tab">
            <span class="label">JS Heap RAM</span>
            <span class="val zinc" id="js-heap">N/A</span>
          </div>
          <div class="row">
            <span class="label">Canvas & DPR</span>
            <span class="val zinc" id="canvas-info">0×0 (@1x)</span>
          </div>
        </div>

        <div class="toolbar" id="three-toolbar" style="display: none;">
          <button class="tool-btn" id="btn-traverse">Audit Scene</button>
          <button class="tool-btn" id="btn-wireframe">Wireframe</button>
          <button class="tool-btn" id="btn-log" title="In window.$scene ra Console">$scene</button>
        </div>

        <div class="scene-panel" id="scene-panel" style="display: none;">
          <div class="scene-summary" id="scene-summary">Đang quét scene...</div>
          <div class="sub-heading">Top 5 Heavy Meshes (Triangles)</div>
          <div class="tree-list" id="heavy-list" style="margin-bottom: 6px;"></div>
          <div class="sub-heading" style="color: #a1a1aa;">Scene Nodes</div>
          <div class="tree-list" id="tree-list"></div>
        </div>
      </div>
    `;

    bindEvents();
  };

  const formatNumber = (num) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
    if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
    return num.toLocaleString();
  };

  const renderCanvasTabs = (contexts) => {
    const tabsEl = shadowRoot.getElementById("canvas-tabs");
    if (!contexts || contexts.length < 2 || isCollapsed) {
      tabsEl.style.display = "none";
      return;
    }

    tabsEl.style.display = "flex";
    const key = contexts.map((c) => `${c.id}:${c.label}`).join("|");
    if (tabsEl.dataset.key !== key) {
      tabsEl.dataset.key = key;
      tabsEl.innerHTML = contexts
        .map(
          (c) =>
            `<button class="canvas-tab ${c.id === activeContextId ? "active" : ""}" data-cid="${c.id}" title="${c.label} (${c.width}×${c.height})">${c.label}</button>`
        )
        .join("");

      tabsEl.querySelectorAll(".canvas-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          activeContextId = Number(btn.getAttribute("data-cid"));
          renderMetrics();
        });
      });
    } else {
      tabsEl.querySelectorAll(".canvas-tab").forEach((btn) => {
        const cid = Number(btn.getAttribute("data-cid"));
        btn.classList.toggle("active", cid === activeContextId);
      });
    }
  };

  const renderMetrics = () => {
    if (!isVisible || !latestPayload || !shadowRoot) return;
    const p = latestPayload;

    const fpsEl = shadowRoot.getElementById("fps");
    fpsEl.textContent = `${p.fps} FPS`;
    fpsEl.className = `fps-val ${p.fps >= 55 ? "emerald" : p.fps >= 35 ? "amber" : "rose"}`;
    shadowRoot.getElementById("ms").textContent = `(${p.frameTimeMs}ms)`;

    const lowEl = shadowRoot.getElementById("low-fps");
    lowEl.textContent = `${p.onePercentLowFps} FPS / ${p.maxSpikeMs}ms`;
    lowEl.className = `val ${p.onePercentLowFps >= 50 ? "emerald" : p.onePercentLowFps >= 30 ? "amber" : "rose"}`;

    if (p.jsHeapUsedMb !== null) {
      shadowRoot.getElementById("js-heap").textContent = `${p.jsHeapUsedMb} / ${p.jsHeapLimitMb} MB`;
    }

    const contexts = p.contexts || [];
    if (contexts.length === 0) {
      renderCanvasTabs([]);
      shadowRoot.getElementById("engine-badge").textContent = "No WebGL";
      shadowRoot.getElementById("gpu-time").textContent = "N/A";
      shadowRoot.getElementById("calls").textContent = "0";
      shadowRoot.getElementById("triangles").textContent = "0 (0)";
      shadowRoot.getElementById("state-switches").textContent = "0 sw / 0 fbo";
      shadowRoot.getElementById("textures").textContent = "0 (0 MB)";
      shadowRoot.getElementById("geometries").textContent = "0 (0 MB)";
      shadowRoot.getElementById("shaders").textContent = "0";
      shadowRoot.getElementById("canvas-info").textContent = "0×0 (@1x)";
      shadowRoot.getElementById("three-toolbar").style.display = "none";
      return;
    }

    let m = contexts.find((c) => c.id === activeContextId);
    if (!m) {
      m = contexts[0];
      activeContextId = m.id;
    }

    renderCanvasTabs(contexts);

    shadowRoot.getElementById("engine-badge").textContent = m.engine;

    const gpuEl = shadowRoot.getElementById("gpu-time");
    if (m.gpuTimeMs !== null) {
      gpuEl.textContent = `${m.gpuTimeMs} ms`;
      gpuEl.className = `val ${m.gpuTimeMs <= 8 ? "cyan" : m.gpuTimeMs <= 16 ? "amber" : "rose"}`;
    } else {
      gpuEl.textContent = "N/A";
      gpuEl.className = "val cyan";
    }

    shadowRoot.getElementById("calls").textContent = m.calls.toLocaleString();
    shadowRoot.getElementById("triangles").textContent =
      `${formatNumber(m.triangles)} (${formatNumber(m.trisPerCall)}/call)`;
    shadowRoot.getElementById("state-switches").textContent =
      `${m.programSwitches} sw / ${m.fboBinds} fbo`;

    shadowRoot.getElementById("textures").textContent =
      `${m.textures.toLocaleString()} (${m.texVramMb} MB)`;
    shadowRoot.getElementById("geometries").textContent =
      `${m.geometries.toLocaleString()} (${m.bufVramMb} MB)`;
    shadowRoot.getElementById("shaders").textContent = m.shaders.toLocaleString();
    shadowRoot.getElementById("canvas-info").textContent = `${m.width}×${m.height} (@${m.dpr}x)`;

    shadowRoot.getElementById("three-toolbar").style.display =
      m.hasScene && !isCollapsed ? "flex" : "none";
  };

  const bindEvents = () => {
    const collapseBtn = shadowRoot.getElementById("toggle-collapse");
    const closeBtn = shadowRoot.getElementById("close-hud");
    const metricsBody = shadowRoot.getElementById("metrics-body");
    const scenePanel = shadowRoot.getElementById("scene-panel");

    collapseBtn.addEventListener("click", () => {
      isCollapsed = !isCollapsed;
      metricsBody.style.display = isCollapsed ? "none" : "flex";
      collapseBtn.textContent = isCollapsed ? "▼" : "▲";
      if (isCollapsed) scenePanel.style.display = "none";
      renderMetrics();
    });

    closeBtn.addEventListener("click", () => {
      isVisible = false;
      hostEl.style.display = "none";
    });

    shadowRoot.getElementById("btn-traverse").addEventListener("click", (e) => {
      showScenePanel = !showScenePanel;
      e.target.classList.toggle("active", showScenePanel);
      scenePanel.style.display = showScenePanel ? "block" : "none";
      if (showScenePanel) {
        window.postMessage({ type: "EXT_CMD_TRAVERSE_SCENE" }, "*");
      }
    });

    shadowRoot.getElementById("btn-wireframe").addEventListener("click", () => {
      window.postMessage({ type: "EXT_CMD_TOGGLE_WIREFRAME" }, "*");
    });

    shadowRoot.getElementById("btn-log").addEventListener("click", () => {
      window.postMessage({ type: "EXT_CMD_LOG_SCENE" }, "*");
    });

    const dragHandle = shadowRoot.getElementById("drag-handle");
    let isDragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      isDragging = true;
      const rect = hostEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      hostEl.style.right = "auto";
      hostEl.style.left = `${origLeft}px`;
      hostEl.style.top = `${origTop}px`;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      hostEl.style.left = `${origLeft + (e.clientX - startX)}px`;
      hostEl.style.top = `${origTop + (e.clientY - startY)}px`;
    });

    window.addEventListener("mouseup", () => { isDragging = false; });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "WEBGL_PERF_METRICS") {
      latestPayload = event.data.payload;
      if (isVisible) {
        mountHUD();
        renderMetrics();
      }
    }

    if (event.data.type === "EXT_WIREFRAME_STATE" && shadowRoot) {
      wireframeOn = event.data.enabled;
      shadowRoot.getElementById("btn-wireframe").classList.toggle("active", wireframeOn);
    }

    if (event.data.type === "EXT_REFRESH_SCENE" && showScenePanel) {
      window.postMessage({ type: "EXT_CMD_TRAVERSE_SCENE" }, "*");
    }

    if (event.data.type === "EXT_SCENE_REPORT" && event.data.payload && shadowRoot) {
      const { totalObjects, meshes, instancedMeshes, lights, shadowCasters, topHeavy, items } = event.data.payload;
      shadowRoot.getElementById("scene-summary").innerHTML =
        `<span>Obj: <b>${totalObjects}</b></span>` +
        `<span>Mesh: <b>${meshes}</b></span>` +
        `<span>Inst: <b>${instancedMeshes}</b></span>` +
        `<span>Light: <b>${lights}</b></span>` +
        `<span>Shadow: <b>${shadowCasters}</b></span>`;

      const renderNodeList = (containerId, list) => {
        const el = shadowRoot.getElementById(containerId);
        el.innerHTML = list.map((item) => `
          <div class="tree-item">
            <span class="tree-name" title="${item.name} [${item.type}]">${item.name}</span>
            ${item.tris > 0 ? `<span class="tree-meta">${formatNumber(item.tris)}</span>` : ""}
            <button class="vis-btn ${item.visible ? "" : "off"}" data-uuid="${item.uuid}">
              ${item.visible ? "👁" : "🚫"}
            </button>
          </div>
        `).join("");

        el.querySelectorAll(".vis-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            window.postMessage({
              type: "EXT_CMD_TOGGLE_VISIBLE",
              uuid: btn.getAttribute("data-uuid"),
            }, "*");
          });
        });
      };

      renderNodeList("heavy-list", topHeavy || []);
      renderNodeList("tree-list", items || []);
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_WEBGL_HUD") {
      isVisible = !isVisible;
      if (isVisible) {
        mountHUD();
        hostEl.style.display = "block";
        renderMetrics();
      } else if (hostEl) {
        hostEl.style.display = "none";
      }
    }

    if (msg.type === "POPUP_CMD_RELAY" && msg.cmd) {
      window.postMessage({ type: msg.cmd }, "*");
    }

    if (msg.type === "POPUP_CMD_OPEN_TRAVERSE") {
      mountHUD();
      isVisible = true;
      hostEl.style.display = "block";
      showScenePanel = true;
      shadowRoot.getElementById("scene-panel").style.display = "block";
      shadowRoot.getElementById("btn-traverse").classList.add("active");
      renderMetrics();
      window.postMessage({ type: "EXT_CMD_TRAVERSE_SCENE" }, "*");
    }
  });
})();
