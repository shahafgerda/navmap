// שמירה בדרייב של המשתמש/ת עצמו/ה: קובץ אחד בתיקייה הנסתרת של האפליקציה (appDataFolder).
// ההרשאה drive.appdata נותנת לכלי גישה רק לתיקייה הזאת, ולא לשום קובץ אחר בדרייב.
// שום דבר לא עובר דרך השרת שלנו: הדפדפן מדבר ישירות עם גוגל.
window.NavDrive = (function () {
  var C = window.NAVMAP_CONFIG || {};
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var FILE_NAME = 'navmap-data.json';
  // שליחת סיכום מפגש מהג'ימייל של המנטור/ית (17.11.2026, הכרעת שחף): הרשאה נפרדת, נדרשת רק בשליחה הראשונה.
  // gmail.send מאפשרת רק לשלוח. הכלי אינו קורא את תיבת הדואר, והמייל אינו עובר בשרת שלנו.
  var SCOPE_MAIL = 'https://www.googleapis.com/auth/gmail.send';
  var token = null, tokenExp = 0, client = null, fileId = null, gisLoading = null;
  var mailTok = null, mailExp = 0;

  function available() { return !!C.googleClientId; }

  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.onload = function () { res(); }; s.onerror = function () { gisLoading = null; rej(new Error('לא הצלחנו לטעון את הכניסה של גוגל')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  // interactive: true רק מלחיצה של המשתמש/ת, אחרת הדפדפן יחסום את החלון
  function getToken(interactive) {
    if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
    return loadGis().then(function () {
      return new Promise(function (res, rej) {
        client = google.accounts.oauth2.initTokenClient({
          client_id: C.googleClientId, scope: SCOPE,
          callback: function (r) {
            if (r && r.access_token) { token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; res(token); }
            else rej(new Error((r && r.error) || 'הכניסה לא הושלמה'));
          },
          error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'חלון הכניסה נסגר' : 'הכניסה לא הצליחה')); }
        });
        client.requestAccessToken({ prompt: interactive ? '' : 'none' });
      });
    });
  }

  function api(path, opt) {
    return getToken(false).then(function (tk) {
      opt = opt || {}; opt.headers = Object.assign({ Authorization: 'Bearer ' + tk }, opt.headers || {});
      return fetch('https://www.googleapis.com' + path, opt);
    }).then(function (r) {
      if (r.status === 401) { token = null; throw new Error('החיבור לדרייב פג. התחברו שוב.'); }
      if (!r.ok) throw new Error('הדרייב לא ענה (' + r.status + ')');
      return r;
    });
  }

  function findFile() {
    if (fileId) return Promise.resolve(fileId);
    var q = encodeURIComponent("name='" + FILE_NAME + "'");
    return api('/drive/v3/files?spaces=appDataFolder&fields=files(id,modifiedTime)&q=' + q)
      .then(function (r) { return r.json(); })
      .then(function (j) { fileId = j.files && j.files[0] ? j.files[0].id : null; return fileId; });
  }

  // מחזיר את האובייקט ששמור בדרייב, או null כשעוד אין
  function read() {
    return findFile().then(function (id) {
      if (!id) return null;
      return api('/drive/v3/files/' + id + '?alt=media').then(function (r) { return r.json(); });
    });
  }

  function write(obj) {
    var body = JSON.stringify(obj);
    return findFile().then(function (id) {
      if (id) return api('/upload/drive/v3/files/' + id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: body });
      var boundary = 'navmap' + Date.now();
      var meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
      var multi = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
        '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
      return api('/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multi })
        .then(function (r) { return r.json(); }).then(function (j) { fileId = j.id; });
    });
  }

  function remove() {
    return findFile().then(function (id) {
      if (!id) return;
      return api('/drive/v3/files/' + id, { method: 'DELETE' }).then(function () { fileId = null; });
    });
  }

  function signOut() {
    try { if (token && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(token, function () {}); } catch (e) {}
    token = null; tokenExp = 0; fileId = null;
  }

  function mailToken(hint) {
    if (mailTok && Date.now() < mailExp - 60000) return Promise.resolve(mailTok);
    return loadGis().then(function () {
      return new Promise(function (res, rej) {
        var c = google.accounts.oauth2.initTokenClient({
          client_id: C.googleClientId, scope: SCOPE_MAIL, include_granted_scopes: false, login_hint: hint || undefined,
          callback: function (r) {
            if (r && r.access_token && (!google.accounts.oauth2.hasGrantedAllScopes || google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE_MAIL))) {
              mailTok = r.access_token; mailExp = Date.now() + (r.expires_in || 3600) * 1000; res(mailTok);
            } else rej(new Error(r && r.error === 'access_denied' ? 'לא ניתנה הרשאה לשליחה' : 'לא ניתנה הרשאה לשליחה'));
          },
          error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'חלון ההרשאה נסגר' : 'ההרשאה לשליחה לא הושלמה')); }
        });
        c.requestAccessToken({ prompt: '' });
      });
    });
  }
  // raw: הודעת MIME מלאה כמחרוזת. מחזיר את מזהה ההודעה שנשלחה, או זורק שגיאה. לעולם לא "הצליח" בלי תשובה מגוגל.
  function sendMail(raw, hint) {
    var b64 = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    function go(tk) {
      return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64 })
      });
    }
    return mailToken(hint).then(go).then(function (r) {
      if (r.status === 401) { mailTok = null; return mailToken(hint).then(go); }
      return r;
    }).then(function (r) {
      if (r.status === 403) throw new Error('גוגל לא אישרה את השליחה מהחשבון הזה (403)');
      if (!r.ok) throw new Error('גוגל לא שלחה את המייל (' + r.status + ')');
      return r.json();
    }).then(function (j) { if (!j || !j.id) throw new Error('לא התקבל אישור שליחה מגוגל'); return j.id; });
  }

  return { available: available, sendMail: sendMail, connect: function () { return getToken(true); }, reconnect: function () { return getToken(false); }, read: read, write: write, remove: remove, signOut: signOut };
})();
