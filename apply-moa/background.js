"use strict";
// Registered files and application history are available only to extension pages.
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard.html");
  const tabs = await chrome.tabs.query({url});
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, {active: true});
    await chrome.windows.update(tabs[0].windowId, {focused: true});
  } else {
    await chrome.tabs.create({url});
  }
});
