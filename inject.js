(() => {
  if (window.__WEBGL_PERF_INJECTED__) return;
  window.__WEBGL_PERF_INJECTED__ = true;

  // Quản lý nhiều WebGL Context (mỗi canvas 1 tracker riêng)
  const contextTrackers = new Map(); // WebGLRenderingContext -> tracker
  const trackerList = [];
  let nextContextId = 1;

  // Three.js Scene & Renderer tracking
  const capturedScenes = new Set();
  const capturedRenderers = new Set();
  let capturedScene = null;
  let wireframeEnabled = false;

  const pickMainScene = () => {
    let bestScene = null;
    let maxScore = -1;

    capturedScenes.forEach((sc) => {
      if (!sc || typeof sc.traverse !== "function" || !Array.isArray(sc.children)) return;
      let score = 0;
      sc.traverse((o) => {
        if (o.isMesh) score += 10;
        if (o.isLight) score += 50;
        score += 1;
      });
      if (score > maxScore) {
        maxScore = score;
        bestScene = sc;
      }
    });

    if (bestScene) {
      capturedScene = bestScene;
      window.$scene = capturedScene;
      window.$allScenes = Array.from(capturedScenes);
    }
    return capturedScene;
  };

  // 1. Bắt Three.js Scene & Renderer qua __THREE_DEVTOOLS__ (bảo toàn EventTarget nếu có)
  const existingDevtools = window.__THREE_DEVTOOLS__;
  const handleThreeEvent = (event) => {
    if (event && event.type === "observe" && event.detail) {
      if (event.detail.isScene && Array.isArray(event.detail.children)) {
        capturedScenes.add(event.detail);
        pickMainScene();
      }
      if (event.detail.render && event.detail.info) {
        capturedRenderers.add(event.detail);
        window.$renderer = event.detail;
        // Gắn renderer vào đúng tracker của WebGL context tương ứng
        if (typeof event.detail.getContext === "function") {
          const gl = event.detail.getContext();
          const tracker = contextTrackers.get(gl);
          if (tracker) tracker.renderer = event.detail;
        }
      }
    }
  };

  if (existingDevtools && typeof existingDevtools.dispatchEvent === "function") {
    const origDispatch = existingDevtools.dispatchEvent.bind(existingDevtools);
    existingDevtools.dispatchEvent = (event) => {
      handleThreeEvent(event);
      return origDispatch(event);
    };
  } else {
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(event) {
        handleThreeEvent(event);
      },
    };
  }

  // Fallback bắt Scene qua setter isScene (không dùng chung biến closure gây ô nhiễm object khác)
  try {
    const origDefine = Object.defineProperty;
    origDefine(Object.prototype, "isScene", {
      configurable: true,
      get() {
        return undefined;
      },
      set(val) {
        if (
          this !== Object.prototype &&
          !(this.constructor && this.constructor.prototype === this) &&
          val === true &&
          typeof this.traverse === "function" &&
          Array.isArray(this.children)
        ) {
          capturedScenes.add(this);
          queueMicrotask(() => pickMainScene());
        }
        origDefine(this, "isScene", {
          value: val,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      },
    });
  } catch (e) {}

  // Tính số bytes/pixel dựa trên internalformat, format và type WebGL1/WebGL2
  const getBytesPerPixel = (internalformat, format, type) => {
    switch (internalformat) {
      case 0x8229: // R8
      case 0x8F94: // R8_SNORM
      case 0x1903: // RED (when sized or fallback)
      case 0x1909: // LUMINANCE
      case 0x1906: // ALPHA
        if (type === 0x1406) return 4; // FLOAT
        if (type === 0x140B || type === 0x8D61) return 2; // HALF_FLOAT
        return 1;
      case 0x822B: // RG8
      case 0x8F95: // RG8_SNORM
      case 0x822D: // R16F
      case 0x81A5: // DEPTH_COMPONENT16
      case 0x8D62: // RGB565
      case 0x8056: // RGBA4
      case 0x8057: // RGB5_A1
        return 2;
      case 0x8051: // RGB8
      case 0x8C41: // SRGB8
      case 0x8F96: // RGB8_SNORM
        return 3;
      case 0x8058: // RGBA8
      case 0x8C43: // SRGB8_ALPHA8
      case 0x8F97: // RGBA8_SNORM
      case 0x8059: // RGB10_A2
      case 0x8C3A: // R11F_G11F_B10F
      case 0x8C3D: // RGB9_E5
      case 0x822F: // RG16F
      case 0x822E: // R32F
      case 0x81A6: // DEPTH_COMPONENT24
      case 0x8CAC: // DEPTH_COMPONENT32F
      case 0x88F0: // DEPTH24_STENCIL8
        return 4;
      case 0x881B: // RGB16F
        return 6;
      case 0x881A: // RGBA16F
      case 0x8230: // RG32F
      case 0x8CAD: // DEPTH32F_STENCIL8
        return 8;
      case 0x8815: // RGB32F
        return 12;
      case 0x8814: // RGBA32F
        return 16;
      default:
        break;
    }

    // Unsized formats (WebGL1 & texImage2D)
    if (type === 0x8363 || type === 0x8033 || type === 0x8034) return 2; // 5_6_5, 4_4_4_4, 5_5_5_1
    if (type === 0x84FA) return 4; // UNSIGNED_INT_24_8
    if (type === 0x8DAD) return 8; // FLOAT_32_UNSIGNED_INT_24_8_REV
    if (type === 0x8368) return 4; // UNSIGNED_INT_2_10_10_10_REV

    let channels = 4;
    if (format === 0x1909 || format === 0x1906 || format === 0x1903 || format === 0x1902) {
      channels = 1; // LUMINANCE, ALPHA, RED, DEPTH_COMPONENT
    } else if (format === 0x190A || format === 0x8227) {
      channels = 2; // LUMINANCE_ALPHA, RG
    } else if (format === 0x1907) {
      channels = 3; // RGB
    } else if (format === 0x84F9) {
      return 4; // DEPTH_STENCIL
    }

    let bytesPerChannel = 1;
    if (type === 0x1406 || type === 0x1405 || type === 0x1404) bytesPerChannel = 4; // FLOAT, UNSIGNED_INT, INT
    else if (type === 0x140B || type === 0x8D61 || type === 0x1403 || type === 0x1402) bytesPerChannel = 2; // HALF_FLOAT, UNSIGNED_SHORT, SHORT

    return channels * bytesPerChannel;
  };

  // Tạo hoặc lấy tracker riêng cho từng WebGL context
  const getTracker = (gl) => {
    let tracker = contextTrackers.get(gl);
    if (tracker) return tracker;

    const canvas = gl.canvas || null;
    const id = nextContextId++;
    const rawId = canvas && canvas.id ? canvas.id.trim() : "";
    const label = rawId ? (rawId.length > 14 ? rawId.slice(0, 12) + "…" : rawId) : `Canvas ${id}`;

    let gpuExt = null;
    try {
      if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) {
        gpuExt = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      }
    } catch (e) {}

    // Kiểm tra xem có Three.js WebGLRenderer nào đã tạo trước đó khớp context này không
    let matchedRenderer = null;
    capturedRenderers.forEach((r) => {
      if (typeof r.getContext === "function" && r.getContext() === gl) {
        matchedRenderer = r;
      }
    });

    tracker = {
      id,
      label,
      gl,
      canvas,
      renderer: matchedRenderer,
      activeTexUnit: 0x84C0, // TEXTURE0
      boundTextures: new Map(), // unit -> Map(target -> WebGLTexture)
      textureLevels: new WeakMap(), // WebGLTexture -> Map("target:level" -> bytes)
      textureTotalBytes: new WeakMap(), // WebGLTexture -> total bytes
      mipmapTextures: new WeakSet(),
      currentBuffers: new Map(), // target -> WebGLBuffer
      bufferSizes: new WeakMap(),
      createdTextures: new WeakSet(),
      createdBuffers: new WeakSet(),
      createdPrograms: new WeakSet(),
      lastProgram: null,
      stats: {
        calls: 0,
        triangles: 0,
        programSwitches: 0,
        fboBinds: 0,
        textures: 0,
        buffers: 0,
        programs: 0,
        textureBytes: 0,
        bufferBytes: 0,
      },
      lastFrame: {
        calls: 0,
        triangles: 0,
        programSwitches: 0,
        fboBinds: 0,
      },
      idleFrames: 0,
      lastDrawTime: 0,
      hasRendered: false,
      gpuExt,
      gpuQueries: [],
      activeGpuQuery: null,
      lastGpuTimeMs: null,
    };

    contextTrackers.set(gl, tracker);
    trackerList.push(tracker);
    return tracker;
  };

  // Cập nhật dung lượng texture theo từng (target, level) để hỗ trợ CubeMap (6 mặt) & Mipmap chính xác
  const updateTextureLevelBytes = (tracker, tex, target, level, newBytes) => {
    if (!tex) return;
    let levelMap = tracker.textureLevels.get(tex);
    if (!levelMap) {
      levelMap = new Map();
      tracker.textureLevels.set(tex, levelMap);
    }
    const key = `${target}:${level}`;
    levelMap.set(key, newBytes);

    let total = 0;
    levelMap.forEach((b) => { total += b; });
    if (tracker.mipmapTextures.has(tex) && levelMap.size <= 6) {
      // Nếu gọi generateMipmap mà chưa ghi từng level > 0 riêng lẻ
      total = Math.round(total * 1.33);
    }

    const prevTotal = tracker.textureTotalBytes.get(tex) || 0;
    tracker.stats.textureBytes = Math.max(0, tracker.stats.textureBytes - prevTotal + total);
    tracker.textureTotalBytes.set(tex, total);
  };

  // Chuẩn hóa target CubeMap mặt về target Texture nếu bindTexture dùng TEXTURE_CUBE_MAP (0x8513)
  const getBoundTexture = (tracker, target) => {
    const unitMap = tracker.boundTextures.get(tracker.activeTexUnit);
    if (!unitMap) return null;
    if (target >= 0x8515 && target <= 0x851A) {
      return unitMap.get(0x8513) || null; // TEXTURE_CUBE_MAP
    }
    return unitMap.get(target) || null;
  };

  // 2. Hook WebGLRenderingContext & WebGL2RenderingContext
  const hookWebGLContext = (ContextProto) => {
    if (!ContextProto || ContextProto.__isPerfHooked) return;
    ContextProto.__isPerfHooked = true;

    const calcTriangles = (mode, count, instanceCount = 1) => {
      if (mode === 4) return (count / 3) * instanceCount;
      if (mode === 5 || mode === 6) return Math.max(0, count - 2) * instanceCount;
      return 0;
    };

    const wrapDraw = (fnName, getTriFn) => {
      const orig = ContextProto[fnName];
      if (!orig) return;
      ContextProto[fnName] = function () {
        const tracker = getTracker(this);
        tracker.stats.calls++;
        tracker.stats.triangles += getTriFn.apply(null, arguments);
        tracker.hasRendered = true;
        tracker.lastDrawTime = performance.now();
        return orig.apply(this, arguments);
      };
    };

    wrapDraw("drawArrays", (mode, first, count) => calcTriangles(mode, count));
    wrapDraw("drawElements", (mode, count) => calcTriangles(mode, count));
    wrapDraw("drawArraysInstanced", (mode, first, count, inst) => calcTriangles(mode, count, inst));
    wrapDraw("drawElementsInstanced", (mode, count, type, off, inst) => calcTriangles(mode, count, inst));

    // State Changes (Program & FBO) theo từng context
    if (ContextProto.useProgram) {
      const origUseProgram = ContextProto.useProgram;
      ContextProto.useProgram = function (prog) {
        const tracker = getTracker(this);
        if (prog !== tracker.lastProgram) {
          tracker.stats.programSwitches++;
          tracker.lastProgram = prog;
        }
        return origUseProgram.apply(this, arguments);
      };
    }

    if (ContextProto.bindFramebuffer) {
      const origBindFbo = ContextProto.bindFramebuffer;
      ContextProto.bindFramebuffer = function (target, fb) {
        if (fb !== null) {
          getTracker(this).stats.fboBinds++;
        }
        return origBindFbo.apply(this, arguments);
      };
    }

    // Texture Binding & VRAM
    if (ContextProto.activeTexture) {
      const origActiveTex = ContextProto.activeTexture;
      ContextProto.activeTexture = function (unit) {
        getTracker(this).activeTexUnit = unit;
        return origActiveTex.apply(this, arguments);
      };
    }

    if (ContextProto.bindTexture) {
      const origBindTex = ContextProto.bindTexture;
      ContextProto.bindTexture = function (target, tex) {
        const tracker = getTracker(this);
        let unitMap = tracker.boundTextures.get(tracker.activeTexUnit);
        if (!unitMap) {
          unitMap = new Map();
          tracker.boundTextures.set(tracker.activeTexUnit, unitMap);
        }
        unitMap.set(target, tex);
        return origBindTex.apply(this, arguments);
      };
    }

    if (ContextProto.texImage2D) {
      const origTexImage2D = ContextProto.texImage2D;
      ContextProto.texImage2D = function () {
        const tracker = getTracker(this);
        const target = arguments[0];
        const level = arguments[1];
        const tex = getBoundTexture(tracker, target);
        let bytes = 0;

        if (arguments.length >= 9) {
          const internalformat = arguments[2];
          const w = arguments[3];
          const h = arguments[4];
          const format = arguments[6];
          const type = arguments[7];
          if (w > 0 && h > 0) {
            bytes = w * h * getBytesPerPixel(internalformat, format, type);
          }
        } else if (arguments.length === 6) {
          const internalformat = arguments[2];
          const format = arguments[3];
          const type = arguments[4];
          const src = arguments[5];
          const w = src?.videoWidth || src?.naturalWidth || src?.width || 0;
          const h = src?.videoHeight || src?.naturalHeight || src?.height || 0;
          if (w > 0 && h > 0) {
            bytes = w * h * getBytesPerPixel(internalformat, format, type);
          }
        }

        if (tex && bytes > 0) {
          updateTextureLevelBytes(tracker, tex, target, level, bytes);
        }
        return origTexImage2D.apply(this, arguments);
      };
    }

    if (ContextProto.texStorage2D) {
      const origTexStorage2D = ContextProto.texStorage2D;
      ContextProto.texStorage2D = function (target, levels, internalformat, w, h) {
        const tracker = getTracker(this);
        const tex = getBoundTexture(tracker, target);
        if (tex && w > 0 && h > 0) {
          const bpp = getBytesPerPixel(internalformat, internalformat, 0);
          const mipFactor = levels > 1 ? 1.33 : 1;
          const faces = target === 0x8513 ? 6 : 1; // TEXTURE_CUBE_MAP
          const bytes = Math.round(w * h * bpp * mipFactor * faces);
          updateTextureLevelBytes(tracker, tex, target, 0, bytes);
        }
        return origTexStorage2D.apply(this, arguments);
      };
    }

    if (ContextProto.compressedTexImage2D) {
      const origCompressedTex = ContextProto.compressedTexImage2D;
      ContextProto.compressedTexImage2D = function () {
        const tracker = getTracker(this);
        const target = arguments[0];
        const level = arguments[1];
        const tex = getBoundTexture(tracker, target);
        let bytes = 0;
        if (typeof arguments[6] === "number") {
          bytes = arguments[6];
        } else if (arguments[6]) {
          const src = arguments[6];
          if (typeof arguments[8] === "number" && arguments[8] > 0) {
            bytes = arguments[8] * (src.BYTES_PER_ELEMENT || 1);
          } else {
            bytes = src.byteLength || 0;
          }
        }
        if (tex && bytes > 0) {
          updateTextureLevelBytes(tracker, tex, target, level, bytes);
        }
        return origCompressedTex.apply(this, arguments);
      };
    }

    if (ContextProto.generateMipmap) {
      const origGenMip = ContextProto.generateMipmap;
      ContextProto.generateMipmap = function (target) {
        const tracker = getTracker(this);
        const tex = getBoundTexture(tracker, target);
        if (tex && !tracker.mipmapTextures.has(tex)) {
          tracker.mipmapTextures.add(tex);
          const prevTotal = tracker.textureTotalBytes.get(tex) || 0;
          const levelMap = tracker.textureLevels.get(tex);
          if (prevTotal > 0 && levelMap && levelMap.size <= 6) {
            const newTotal = Math.round(prevTotal * 1.33);
            tracker.stats.textureBytes = Math.max(0, tracker.stats.textureBytes - prevTotal + newTotal);
            tracker.textureTotalBytes.set(tex, newTotal);
          }
        }
        return origGenMip.apply(this, arguments);
      };
    }

    // Buffer Binding & VRAM (hỗ trợ mọi buffer target: ARRAY, ELEMENT, UNIFORM, v.v.)
    if (ContextProto.bindBuffer) {
      const origBindBuf = ContextProto.bindBuffer;
      ContextProto.bindBuffer = function (target, buf) {
        getTracker(this).currentBuffers.set(target, buf);
        return origBindBuf.apply(this, arguments);
      };
    }

    if (ContextProto.bufferData) {
      const origBufferData = ContextProto.bufferData;
      ContextProto.bufferData = function (target, srcData, usage, srcOffset, length) {
        const tracker = getTracker(this);
        const buf = tracker.currentBuffers.get(target);
        let byteLen = 0;
        if (typeof srcData === "number") {
          byteLen = srcData;
        } else if (srcData) {
          if (typeof length === "number" && length > 0 && srcData.BYTES_PER_ELEMENT) {
            byteLen = length * srcData.BYTES_PER_ELEMENT;
          } else {
            byteLen = srcData.byteLength || 0;
          }
        }
        if (buf && byteLen > 0) {
          const prev = tracker.bufferSizes.get(buf) || 0;
          tracker.stats.bufferBytes = Math.max(0, tracker.stats.bufferBytes - prev + byteLen);
          tracker.bufferSizes.set(buf, byteLen);
        }
        return origBufferData.apply(this, arguments);
      };
    }

    // Đếm tạo / xóa tài nguyên an toàn bằng WeakSet
    const wrapLifecycle = (createFn, deleteFn, countKey, setKey, sizeMapKey, bytesKey) => {
      const origCreate = ContextProto[createFn];
      const origDelete = ContextProto[deleteFn];
      if (origCreate) {
        ContextProto[createFn] = function () {
          const res = origCreate.apply(this, arguments);
          if (res) {
            const tracker = getTracker(this);
            tracker.stats[countKey]++;
            tracker[setKey].add(res);
          }
          return res;
        };
      }
      if (origDelete) {
        ContextProto[deleteFn] = function (res) {
          if (res) {
            const tracker = getTracker(this);
            if (tracker[setKey].has(res)) {
              tracker[setKey].delete(res);
              tracker.stats[countKey] = Math.max(0, tracker.stats[countKey] - 1);
              if (sizeMapKey && bytesKey) {
                const prev = tracker[sizeMapKey].get(res) || 0;
                tracker.stats[bytesKey] = Math.max(0, tracker.stats[bytesKey] - prev);
                tracker[sizeMapKey].delete(res);
              }
            }
          }
          return origDelete.apply(this, arguments);
        };
      }
    };

    wrapLifecycle("createTexture", "deleteTexture", "textures", "createdTextures", "textureTotalBytes", "textureBytes");
    wrapLifecycle("createBuffer", "deleteBuffer", "buffers", "createdBuffers", "bufferSizes", "bufferBytes");
    wrapLifecycle("createProgram", "deleteProgram", "programs", "createdPrograms");
  };

  hookWebGLContext(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
  hookWebGLContext(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);

  // 3. Xử lý lệnh Traverse & Audit Three.js Scene
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === "EXT_CMD_TRAVERSE_SCENE") {
      pickMainScene();
      if (!capturedScene || typeof capturedScene.traverse !== "function") {
        window.postMessage({ type: "EXT_SCENE_REPORT", payload: null }, "*");
        return;
      }

      let meshes = 0;
      let instancedMeshes = 0;
      let lights = 0;
      let shadowCasters = 0;
      let totalObjects = 0;
      const items = [];
      const heavyCandidates = [];

      capturedScene.traverse((obj) => {
        totalObjects++;
        if (obj.castShadow) shadowCasters++;
        if (obj.isLight) lights++;

        let estTris = 0;
        if (obj.isMesh && obj.geometry) {
          const geo = obj.geometry;
          const rawCount = geo.index
            ? geo.index.count
            : (geo.attributes?.position?.count || 0);
          const drawCount =
            geo.drawRange && geo.drawRange.count !== Infinity
              ? Math.min(rawCount, geo.drawRange.count)
              : rawCount;
          const baseTris = Math.round(drawCount / 3);
          const mult = obj.isInstancedMesh ? (obj.count || 1) : 1;
          estTris = baseTris * mult;

          if (obj.isInstancedMesh) instancedMeshes++;
          else meshes++;

          if (estTris > 0) {
            heavyCandidates.push({
              uuid: obj.uuid,
              name: obj.name || `(${obj.type})`,
              type: obj.isInstancedMesh ? `Instanced×${obj.count}` : "Mesh",
              tris: estTris,
              visible: obj.visible,
              castShadow: Boolean(obj.castShadow),
            });
          }
        }

        if (items.length < 150 && (obj.isMesh || obj.isGroup || obj.isLight)) {
          items.push({
            uuid: obj.uuid,
            name: obj.name || `(${obj.type})`,
            type: obj.isInstancedMesh ? `Instanced×${obj.count}` : obj.type,
            tris: estTris,
            visible: obj.visible,
          });
        }
      });

      heavyCandidates.sort((a, b) => b.tris - a.tris);
      const topHeavy = heavyCandidates.slice(0, 5);

      window.postMessage({
        type: "EXT_SCENE_REPORT",
        payload: {
          totalObjects,
          meshes,
          instancedMeshes,
          lights,
          shadowCasters,
          topHeavy,
          items,
        },
      }, "*");
    }

    if (event.data.type === "EXT_CMD_TOGGLE_WIREFRAME") {
      pickMainScene();
      if (!capturedScene) return;
      wireframeEnabled = !wireframeEnabled;
      capturedScene.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if ("wireframe" in m) m.wireframe = wireframeEnabled;
          });
        }
      });
      window.postMessage({ type: "EXT_WIREFRAME_STATE", enabled: wireframeEnabled }, "*");
    }

    if (event.data.type === "EXT_CMD_TOGGLE_VISIBLE" && capturedScene) {
      const target = capturedScene.getObjectByProperty("uuid", event.data.uuid);
      if (target) {
        target.visible = !target.visible;
        window.postMessage({ type: "EXT_REFRESH_SCENE" }, "*");
      }
    }

    if (event.data.type === "EXT_CMD_LOG_SCENE") {
      pickMainScene();
      console.group("%c[Three.js Scene Inspector]", "color: #34d399; font-weight: bold;");
      console.log("window.$scene (Main) =", capturedScene);
      console.log("window.$allScenes =", Array.from(capturedScenes));
      console.log("window.$renderer =", window.$renderer);
      console.groupEnd();
    }
  });

  // 4. Vòng lặp đo FPS, 1% Low FPS, GPU Time & State Changes mỗi 250ms
  let frames = 0;
  let windowFrameTimeSum = 0;
  let windowFrameCount = 0;
  let lastReportTime = performance.now();
  let lastFrameTime = lastReportTime;
  const frameTimeHistory = [];

  const updateTrackerGpuQuery = (tracker) => {
    const gpuExt = tracker.gpuExt;
    const gl = tracker.gl;
    if (!gpuExt || !gl || gl.isContextLost()) return;

    if (tracker.activeGpuQuery) {
      gl.endQuery(gpuExt.TIME_ELAPSED_EXT);
      tracker.gpuQueries.push(tracker.activeGpuQuery);
      tracker.activeGpuQuery = null;
    }

    while (tracker.gpuQueries.length > 0) {
      const q = tracker.gpuQueries[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(gpuExt.GPU_DISJOINT_EXT);
      if (available && !disjoint) {
        const timeNs = gl.getQueryParameter(q, gl.QUERY_RESULT);
        tracker.lastGpuTimeMs = +(timeNs / 1_000_000).toFixed(2);
        gl.deleteQuery(q);
        tracker.gpuQueries.shift();
      } else if (disjoint) {
        gl.deleteQuery(q);
        tracker.gpuQueries.shift();
      } else {
        break;
      }
    }

    if (tracker.gpuQueries.length < 4) {
      const q = gl.createQuery();
      if (q) {
        gl.beginQuery(gpuExt.TIME_ELAPSED_EXT, q);
        tracker.activeGpuQuery = q;
      }
    }
  };

  const snapshotTrackerFrame = (tracker, now) => {
    const s = tracker.stats;
    if (s.calls > 0) {
      tracker.lastFrame.calls = s.calls;
      tracker.lastFrame.triangles = Math.round(s.triangles);
      tracker.lastFrame.programSwitches = s.programSwitches;
      tracker.lastFrame.fboBinds = s.fboBinds;
      tracker.idleFrames = 0;

      s.calls = 0;
      s.triangles = 0;
      s.programSwitches = 0;
      s.fboBinds = 0;
      tracker.lastProgram = null;
    } else {
      tracker.idleFrames++;
      // Chỉ reset về 0 nếu không có draw call nào trong >= 500ms (tránh nhấp nháy ở màn 120Hz+ khi app chạy 30/60fps)
      if (tracker.lastDrawTime > 0 && now - tracker.lastDrawTime >= 500) {
        tracker.lastFrame.calls = 0;
        tracker.lastFrame.triangles = 0;
        tracker.lastFrame.programSwitches = 0;
        tracker.lastFrame.fboBinds = 0;
      }
    }
  };

  const tick = (now) => {
    const delta = now - lastFrameTime;
    lastFrameTime = now;
    frames++;

    if (delta > 0 && delta < 1000) {
      windowFrameTimeSum += delta;
      windowFrameCount++;
      frameTimeHistory.push(delta);
      if (frameTimeHistory.length > 360) frameTimeHistory.shift();
    }

    for (let i = 0; i < trackerList.length; i++) {
      const tracker = trackerList[i];
      if (tracker.gl.isContextLost()) continue;
      updateTrackerGpuQuery(tracker);
      snapshotTrackerFrame(tracker, now);
    }

    if (now - lastReportTime >= 250) {
      const elapsed = Math.max(1, now - lastReportTime);
      const fps = Math.round((frames * 1000) / elapsed);
      const avgFrameMs = windowFrameCount > 0 ? +(windowFrameTimeSum / windowFrameCount).toFixed(1) : +delta.toFixed(1);
      frames = 0;
      windowFrameTimeSum = 0;
      windowFrameCount = 0;
      lastReportTime = now;

      let onePercentLowFps = fps;
      let maxSpikeMs = avgFrameMs;
      if (frameTimeHistory.length >= 10) {
        const sorted = [...frameTimeHistory].sort((a, b) => b - a);
        const worstIndex = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.01) - 1));
        const p99FrameMs = sorted[worstIndex];
        onePercentLowFps = Math.round(1000 / Math.max(1, p99FrameMs));
        maxSpikeMs = +sorted[0].toFixed(1);
      }

      const perfMem = performance.memory;
      const jsHeapUsedMb = perfMem ? +(perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(1) : null;
      const jsHeapLimitMb = perfMem ? Math.round(perfMem.jsHeapSizeLimit / (1024 * 1024)) : null;

      // Chỉ giữ canvas đang hiển thị trên DOM, hoặc canvas offscreen đang thực sự render gần đây (< 1s)
      const activeContexts = [];
      for (let i = 0; i < trackerList.length; i++) {
        const t = trackerList[i];
        const c = t.canvas;
        const width = c ? c.clientWidth : 0;
        const height = c ? c.clientHeight : 0;
        const isVisibleCanvas = Boolean(c && c.isConnected && width > 0 && height > 0);
        const isActivelyRendering = t.lastFrame.calls > 0 || (t.lastDrawTime > 0 && now - t.lastDrawTime < 1000);
        if (!isVisibleCanvas && !isActivelyRendering) continue;

        const rInfo = t.renderer && t.renderer.info;
        const calls = t.lastFrame.calls;
        const triangles = t.lastFrame.triangles;
        const trisPerCall = calls > 0 ? Math.round(triangles / calls) : 0;
        const isThree = Boolean(t.renderer || capturedScenes.size > 0);

        activeContexts.push({
          id: t.id,
          label: t.label,
          engine: isThree ? "Three.js" : "WebGL",
          hasScene: capturedScenes.size > 0,
          gpuTimeMs: t.lastGpuTimeMs,
          calls,
          triangles,
          trisPerCall,
          programSwitches: t.lastFrame.programSwitches,
          fboBinds: t.lastFrame.fboBinds,
          geometries: rInfo ? rInfo.memory.geometries : t.stats.buffers,
          textures: rInfo ? rInfo.memory.textures : t.stats.textures,
          shaders: rInfo ? (rInfo.programs ? rInfo.programs.length : t.stats.programs) : t.stats.programs,
          texVramMb: +(t.stats.textureBytes / (1024 * 1024)).toFixed(1),
          bufVramMb: +(t.stats.bufferBytes / (1024 * 1024)).toFixed(1),
          width,
          height,
          dpr: +(window.devicePixelRatio.toFixed(1)),
        });
      }

      // Sắp xếp canvas đang có nhiều thông số & hoạt động nhất lên đầu
      activeContexts.sort((a, b) => {
        const aActive = a.calls > 0 ? 1 : 0;
        const bActive = b.calls > 0 ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;

        const aScore = a.calls * 10 + a.triangles + (a.textures + a.geometries + a.shaders) * 100;
        const bScore = b.calls * 10 + b.triangles + (b.textures + b.geometries + b.shaders) * 100;
        if (bScore !== aScore) return bScore - aScore;

        const aArea = a.width * a.height;
        const bArea = b.width * b.height;
        if (bArea !== aArea) return bArea - aArea;

        return a.id - b.id;
      });

      window.postMessage({
        type: "WEBGL_PERF_METRICS",
        payload: {
          fps,
          onePercentLowFps,
          frameTimeMs: avgFrameMs,
          maxSpikeMs,
          jsHeapUsedMb,
          jsHeapLimitMb,
          contexts: activeContexts,
        },
      }, "*");
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
})();
