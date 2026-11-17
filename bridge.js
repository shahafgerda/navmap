// הגשר לשרת: מחליף את google.script.run של Apps Script בבקשות fetch לשרת הקטן,
// כדי שהקוד הקיים בדף ימשיך לעבוד כמות שהוא גם כשהאתר יושב בגיטהאב.
// בקשת POST עם text/plain אינה מפעילה preflight, ו-Apps Script מחזיר CORS פתוח.
(function () {
  if (window.google && window.google.script && window.google.script.run) return; // מוק מקומי או הרצה בתוך Apps Script
  var C = window.NAVMAP_CONFIG || {};

  function call(fn, args) {
    if (fn === 'apiValueCards') {
      return fetch('value-cards.json').then(function (r) {
        if (!r.ok) throw new Error('קלפי הערכים לא נטענו');
        return r.text();
      });
    }
    if (!C.apiUrl) return Promise.reject(new Error('השכבה המשותפת אינה מחוברת באתר הזה.'));
    return fetch(C.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] })
    }).then(function (r) {
      if (!r.ok) throw new Error('השרת לא ענה (' + r.status + ')');
      return r.json();
    }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || 'שגיאה בשרת');
      return j.result;
    });
  }

  function runner() {
    var ok = function () {}, fail = function () {};
    var proxy = new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (f) { ok = f || ok; return proxy; };
        if (name === 'withFailureHandler') return function (f) { fail = f || fail; return proxy; };
        if (name === 'withUserObject') return function () { return proxy; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          call(String(name), args).then(function (res) { ok(res); }, function (err) { fail(err instanceof Error ? err : new Error(String(err))); });
        };
      }
    });
    return proxy;
  }

  var script = {
    url: {
      getLocation: function (cb) {
        var p = {};
        new URLSearchParams(location.search).forEach(function (v, k) { p[k] = v; });
        cb({ parameter: p, hash: location.hash.replace(/^#/, '') });
      }
    }
  };
  Object.defineProperty(script, 'run', { get: runner });
  window.google = window.google || {};
  window.google.script = script;
  window.NAVMAP_SERVER = !!C.apiUrl;
})();
