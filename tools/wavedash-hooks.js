/* Wavedash 平台钩子，只注入 Wavedash 构建（tools/build-wavedash.mjs）。
   包装游戏的全局 endGame()；window.Wavedash 不存在时为空操作。 */
(function () {
  var W = window.Wavedash;
  if (!W) return;
  try {
    W.updateLoadProgressZeroToOne(1);
    W.init({ debug: false });
    W.requestStats().catch(function () {});
  } catch (e) {}

  function achieve(id) {
    var tries = 0;
    (function attempt() {
      var ok = false;
      try { ok = W.getAchievement(id) || W.setAchievement(id, true); } catch (e) {}
      if (!ok && ++tries < 20) setTimeout(attempt, 1500);
    })();
  }

  var board = null;
  function submitClearTime(ms) {
    if (!board) board = W.getOrCreateLeaderboard('clear-time', 0, 2).then(function (r) { return r.success ? r.data.id : null; }).catch(function () { return null; });
    board.then(function (id) { if (id) W.uploadLeaderboardScore(id, Math.round(ms), true); }).catch(function () {});
  }

  var originalEnd = window.endGame;
  window.endGame = function (win) {
    if (!G.over) {
      if (G.kills > 0) achieve('FIRST_KILL');
      if (G.headshots >= 5) achieve('FIVE_HEADSHOTS');
      if (win) {
        submitClearTime(G.elapsed * 1000);
        achieve('SECTOR_CLEARED');
        if (G.elapsed < 90) achieve('CLEAR_UNDER_90');
        if (G.shots > 0 && G.hits / G.shots >= 0.6) achieve('SHARPSHOOTER');
      }
    }
    return originalEnd.apply(this, arguments);
  };
})();
