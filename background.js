chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_WEBGL_HUD" });
  } catch (err) {
    console.warn("[WebGL Inspector] Tab chưa sẵn sàng hoặc bị hạn chế (chrome://):", err);
  }
});