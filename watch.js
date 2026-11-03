/* Simple Watch for Lampa. Local experimental plugin; no external telemetry. */
(function (root) {
    'use strict';
    var VERSION = '0.1.3';
    function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim(); }
    function year(c) { return parseInt(c.year || String(c.release_date || c.first_air_date || c.alt_name || '').match(/(?:19|20)\d{2}/), 10) || 0; }
    function match(cards, movie) {
        var names = [movie.title, movie.name, movie.original_title, movie.original_name].map(norm).filter(Boolean);
        var exact = cards.filter(function (c) {
            return [c.title, c.name, c.original_title].some(function (n) { return names.indexOf(norm(n)) >= 0; }) && (!year(movie) || year(c) === year(movie));
        });
        return exact.length === 1 ? exact[0] : null;
    }
    function qualities(value, cap) {
        var list = Array.isArray(value) ? value : String(value || '').split(',');
        return list.map(Number).filter(function (q, i, a) { return q >= 144 && q <= cap && a.indexOf(q) === i; }).sort(function (a, b) { return b - a; });
    }
    function streams(post, cap) {
        var rows = [], links = post.player_links || {};
        function add(item, voice, season, episode) {
            if (!item || typeof item.link !== 'string' || !/^https?:\/\//i.test(item.link)) return;
            var bracket = item.link.match(/\[([\d, ]+)\]/);
            var literal = item.link.match(/(?:_|\/)(\d{3,4})\.mp4/i);
            var qs = qualities(item.qualities || (bracket && bracket[1]) || (literal && literal[1]), cap);
            qs.forEach(function (q) {
                var url = bracket ? item.link.replace(bracket[0], String(q)) : item.link.replace('%s', String(q));
                rows.push({voice: voice || 'Оригинал', season: season || 0, episode: episode || 0, quality: q, url: url});
            });
        }
        (Array.isArray(links.movie) ? links.movie : []).forEach(function (item) { add(item, item.translation, 0, 0); });
        Object.keys(links.playlist || {}).forEach(function (sk) {
            var voices = links.playlist[sk];
            Object.keys(voices || {}).forEach(function (voice) {
                Object.keys(voices[voice] || {}).forEach(function (ek) {
                    var item = voices[voice][ek], se = item && String(item.link || '').match(/s(\d+)e(\d+)/i);
                    add(item, voice, se ? +se[1] : parseInt(sk, 10), se ? +se[2] : parseInt(ek, 10));
                });
            });
        });
        return rows;
    }
    function cap(profile) { return profile && profile.is_pro_plus ? 2160 : profile && profile.is_pro ? 1080 : 720; }
    function sortTorrents(rows) {
        var seen = {};
        return rows.filter(function (r) {
            var key = r.MagnetUri || r.Guid || r.Link || (r.Title + ':' + r.Size);
            if (seen[key]) return false; seen[key] = true; return true;
        }).sort(function (a, b) { return (+b.Seeders || 0) - (+a.Seeders || 0); });
    }
    var pure = {norm: norm, year: year, match: match, streams: streams, cap: cap, sortTorrents: sortTorrents};
    if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
    if (root.KVNWatch) return;
    var L, $, API = 'http://filmixapp.cyou/api/v2/';
    function report() {} // Release builds do not send diagnostic events.
    function enabled() { return L.Storage.get('kvn_watch_enabled', true) !== false; }
    function token() { return L.Storage.get('kvn_watch_filmix_token', '') || L.Storage.get('filmix_token', '') || ''; }
    function device() {
        var id = L.Storage.get('kvn_watch_device_id', '');
        if (!id) { id = L.Utils.uid(16); L.Storage.set('kvn_watch_device_id', id); }
        return id;
    }
    function Filmix() {
        var requests = [], dead = false;
        this.get = function (path, args, tok, ok, fail) {
            var n = new L.Reguest(), pairs = {
                user_dev_id: device(), user_dev_name: 'Xiaomi', user_dev_vendor: 'Xiaomi', user_dev_os: '14', user_dev_apk: '2.2.0', app_lang: 'ru-rRU', user_dev_token: tok || ''
            };
            Object.keys(args || {}).forEach(function (k) { pairs[k] = args[k]; });
            var url = API + path + '?' + Object.keys(pairs).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(pairs[k]); }).join('&');
            requests.push(n); n.timeout(15000);
            n.native(url, function (data) {
                if (dead) return;
                try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { fail(); return; }
                ok(data);
            }, function () { if (!dead) fail(); }, false, {headers: {'User-Agent': 'okhttp/3.10.0'}});
        };
        this.destroy = function () { dead = true; requests.forEach(function (n) { n.clear(); }); requests = []; };
    }
    function connectFilmix(back, done) {
        var api = new Filmix(), pending = '', timer, closed = false, busy = false, until = Date.now() + 600000;
        var html = $('<div class="kvn-auth"></div>');
        var text = $('<div></div>').text('Получаем код устройства…').appendTo(html);
        var code = $('<div style="font-size:3em;padding:.4em 0;letter-spacing:.15em"></div>').appendTo(html);
        $('<div></div>').text('Откройте Filmix на телефоне → профиль → Приставки / Устройства → Добавить устройство. Введите код с этого экрана.').appendTo(html);
        var check = $('<div class="selector kvn-row" style="margin-top:1em"></div>').text('Проверить подключение').appendTo(html);
        function finish() { closed = true; clearTimeout(timer); api.destroy(); L.Modal.close(); back(); }
        function poll() {
            if (closed || busy || !pending) return;
            if (Date.now() > until) { text.text('Время ожидания истекло. Вернитесь назад и получите новый код.'); return; }
            busy = true;
            api.get('user_profile', {}, pending, function (p) {
                busy = false;
                if (p && p.user_data && p.user_data.login) {
                    L.Storage.set('kvn_watch_filmix_token', pending);
                    report('filmix_connected', {pro: !!p.user_data.is_pro, proPlus: !!p.user_data.is_pro_plus});
                    finish(); done();
                } else timer = setTimeout(poll, 7000);
            }, function () { busy = false; text.text('Проверка пока не удалась. Повторяем…'); timer = setTimeout(poll, 10000); });
        }
        check.on('hover:enter', function () { clearTimeout(timer); poll(); });
        L.Modal.open({title: 'Подключить Filmix', html: html, size: 'medium', onBack: finish});
        api.get('token_request', {}, '', function (r) {
            if (r && r.status === 'ok' && r.code && r.user_code) {
                pending = r.code; code.text(r.user_code); text.text('Введите этот код в своём аккаунте Filmix.');
                report('filmix_code_ready'); timer = setTimeout(poll, 7000);
            } else text.text('Filmix не выдал код. Вернитесь назад и попробуйте снова.');
        }, function () { text.text('Нет связи с Filmix. Торренты доступны независимо от него.'); });
    }
    function Screen(object) {
        var self = this, movie = object.movie || {}, dead = false, ready = false, active = false, last = null;
        var season = object.season || 1, episode = object.episode || 1, isSeries = !!(movie.name || movie.first_air_date || movie.original_name);
        var fx = new Filmix(), generation = 0, torrentGeneration = 0, allStreams = [], post = null, profile = null, torrentTimer, accountButton, accountState = 'checking';
        var html = $('<div class="kvn-watch"></div>'), heading = $('<div class="kvn-heading"></div>').appendTo(html);
        $('<div class="kvn-title"></div>').text(movie.title || movie.name || 'Смотреть').appendTo(heading);
        var controls = $('<div class="kvn-controls"></div>').appendTo(heading);
        var scroll = new L.Scroll({mask: true, over: true}); html.append(scroll.render()); scroll.minus(heading);
        var film = $('<section class="kvn-section"><h2>Filmix</h2></section>'), tor = $('<section class="kvn-section"><h2>Торренты</h2></section>');
        var columns = $('<div style="display:flex;gap:1.2em;align-items:flex-start"></div>');
        film.css({width:'44%',minWidth:0}); tor.css({width:'56%',minWidth:0});
        columns.append(film).append(tor); scroll.append(columns);
        var filmBody = $('<div></div>').appendTo(film), torBody = $('<div></div>').appendTo(tor);
        function action(parent, title, detail, run) {
            var row = $('<div class="selector kvn-row"></div>').appendTo(parent);
            $('<div class="kvn-row-title"></div>').text(title).appendTo(row);
            if (detail) $('<div class="kvn-detail"></div>').text(detail).appendTo(row);
            row.on('hover:enter', run).on('hover:focus', function () { last = row[0]; if ($.contains(scroll.render()[0], row[0])) scroll.update(row, true); });
            return row;
        }
        function message(parent, text) { $('<div class="kvn-message"></div>').text(text).appendTo(parent); }
        function refreshFocus() { if (active && !dead && L.Controller.enabled().name === 'content') L.Controller.collectionSet(html); }
        function crossColumn(direction) {
            var from = direction === 'right' ? filmBody : torBody;
            var to = direction === 'right' ? torBody : filmBody;
            var rows = from.find('.selector'), index = rows.index(last);
            if (index < 0) return false;
            var targets = to.find('.selector');
            if (targets.length) L.Controller.collectionFocus(targets.eq(Math.min(index, targets.length - 1))[0], html);
            return true;
        }
        function activate() {
            if (dead) return; active = true;
            L.Controller.add('content', {
                toggle: function () { L.Controller.collectionSet(html); L.Controller.collectionFocus(last && $.contains(html[0], last) ? last : false, html); },
                up: function () { if (root.Navigator.canmove('up')) root.Navigator.move('up'); else L.Controller.toggle('head'); },
                down: function () { root.Navigator.move('down'); },
                left: function () { if (crossColumn('left')) return; if (root.Navigator.canmove('left')) root.Navigator.move('left'); else L.Controller.toggle('menu'); },
                right: function () { if (!crossColumn('right')) root.Navigator.move('right'); },
                back: function () { L.Activity.backward(); }
            });
            L.Controller.toggle('content');
        }
        function choose(title, items, onSelect) {
            active = false;
            L.Select.show({title: title, items: items, onBack: activate, onSelect: function (item) { onSelect(item); activate(); }});
        }
        function account() { active = false; connectFilmix(activate, loadFilmix); }
        function updateAccount() {
            if (!accountButton) return;
            var label = 'Проверка…', color = '#b8bdc8';
            if (accountState === 'ok') {
                label = profile.is_pro_plus ? 'PRO+ ✓' : profile.is_pro ? 'PRO ✓' : 'Нет подписки';
                color = profile.is_pro_plus || profile.is_pro ? '#58df90' : '#ff8989';
            } else if (accountState === 'login') { label = 'Войти'; color = '#ff8989'; }
            else if (accountState === 'unknown') { label = 'Не проверено'; color = '#f5c96a'; }
            accountButton.find('.kvn-account-badge').remove();
            $('<span class="kvn-account-badge"></span>').text(label).css('color',color).appendTo(accountButton.find('.kvn-row-title'));
        }
        function drawControls() {
            controls.empty();
            accountButton = action(controls, 'Аккаунт Filmix', '', function () {
                if (!token()) return account();
                choose('Filmix', [{title: 'Проверить подписку', key: 'check'}, {title: 'Подключить другое устройство', key: 'connect'}], function (v) { if (v.key === 'connect') setTimeout(account, 0); else loadFilmix(); });
            });
            updateAccount();
            if (isSeries) {
                action(controls, 'Сезон ' + season, '', function () {
                    var ss = allStreams.map(function (r) { return r.season; }).filter(function (s, i, a) { return s > 0 && a.indexOf(s) === i; }).sort(function (a,b) { return a-b; });
                    if (!ss.length) for (var i = 1; i <= (movie.number_of_seasons || 1); i++) ss.push(i);
                    choose('Сезон', ss.map(function (s) { return {title: 'Сезон ' + s, value: s}; }), function (v) { season = v.value; episode = 1; drawControls(); drawStreams(); loadTorrents(); });
                });
                action(controls, 'Серия ' + episode, '', function () {
                    var es = allStreams.filter(function (r) { return r.season === season; }).map(function (r) { return r.episode; }).filter(function (e,i,a) { return e > 0 && a.indexOf(e) === i; }).sort(function (a,b) {return a-b;});
                    if (!es.length) { L.Noty.show('Список серий появится после загрузки Filmix. В торрентах серия выбирается внутри раздачи.'); return; }
                    choose('Серия', es.map(function (e) { return {title: 'Серия ' + e, value: e}; }), function (v) { episode = v.value; drawControls(); drawStreams(); });
                });
            }
            action(controls, 'Обновить', '', function () { loadFilmix(); loadTorrents(); }); refreshFocus();
        }
        function playFilmix(row) {
            var variants = allStreams.filter(function (r) { return r.voice === row.voice && r.season === row.season && r.episode === row.episode; });
            var q = {}; variants.forEach(function (r) { q[r.quality + 'p'] = r.url; });
            var entry = {title: (movie.title || movie.name) + (row.season ? ' · ' + row.season + ' сезон, ' + row.episode + ' серия' : '') + ' · ' + row.voice, url: row.url, quality: q};
            if (movie.id) L.Favorite.add('history', movie, 100);
            L.Player.play(entry); L.Player.playlist([entry]);
        }
        function drawStreams() {
            if (!post) return;
            filmBody.empty();
            var rows = allStreams.filter(function (r) { return !isSeries || r.season === season && r.episode === episode; });
            if (!rows.length) message(filmBody, 'Для выбранной серии нет доступных вариантов Filmix.');
            var voices = [];
            rows.forEach(function (r) {
                if (voices.indexOf(r.voice) >= 0) return;
                voices.push(r.voice);
                var variants = rows.filter(function (v) { return v.voice === r.voice; }).sort(function (a,b) { return b.quality-a.quality; });
                action(filmBody, r.voice, variants.map(function (v) { return v.quality === 2160 ? '4K' : v.quality + 'p'; }).join(' · '), function () {
                    choose('Качество · ' + r.voice, variants.map(function (v) { return {title:v.quality === 2160 ? '4K' : v.quality + 'p', stream:v}; }), function (v) { playFilmix(v.stream); });
                });
            });
            report('filmix_results', {count: rows.length}); refreshFocus();
        }
        function loadPost(card, gen) {
            filmBody.empty(); message(filmBody, 'Загружаем варианты Filmix…');
            fx.get('post/' + encodeURIComponent(card.id), {}, token(), function (p) {
                if (dead || gen !== generation) return;
                post = p || {}; allStreams = streams(post, cap(profile)); drawControls(); drawStreams();
            }, function () { if (!dead && gen === generation) filmError(); });
        }
        function filmError() { filmBody.empty(); message(filmBody, 'Filmix сейчас не отвечает. Можно выбрать торрент или повторить запрос.'); action(filmBody, 'Повторить Filmix', '', loadFilmix); report('filmix_error'); refreshFocus(); }
        function loadFilmix() {
            var gen = ++generation; post = null; profile = null; accountState = token() ? 'checking' : 'login'; allStreams = []; filmBody.empty(); drawControls();
            if (!token()) { message(filmBody, 'Подключите свою подписку по коду устройства.'); action(filmBody, 'Подключить Filmix', '', account); refreshFocus(); return; }
            message(filmBody, 'Проверяем аккаунт Filmix…');
            fx.get('user_profile', {}, token(), function (p) {
                if (dead || gen !== generation) return;
                if (!p || !p.user_data || !p.user_data.login) { accountState = 'login'; updateAccount(); filmBody.empty(); message(filmBody, 'Нужно заново подключить Filmix.'); action(filmBody, 'Получить код устройства', '', account); refreshFocus(); return; }
                profile = p.user_data;
                accountState = 'ok'; updateAccount();
                fx.get('search', {story: movie.title || movie.name || movie.original_title}, token(), function (found) {
                    if (dead || gen !== generation) return;
                    var cards = Array.isArray(found) ? found : found && (found.results || found.data) || [], exact = match(cards, movie);
                    if (exact) return loadPost(exact, gen);
                    filmBody.empty(); message(filmBody, cards.length ? 'Уточните название в Filmix:' : 'Filmix не нашёл это название. Торренты доступны ниже.');
                    cards.slice(0, 12).forEach(function (c) { action(filmBody, c.title || c.name, String(year(c) || ''), function () { loadPost(c, gen); }); }); refreshFocus();
                }, function () { if (!dead && gen === generation) filmError(); });
            }, function () { if (!dead && gen === generation) { accountState = 'unknown'; updateAccount(); filmError(); } });
        }
        function loadTorrents() {
            clearTimeout(torrentTimer);
            var gen = ++torrentGeneration, ended = false;
            torBody.empty(); message(torBody, 'Ищем раздачи…');
            function fail() { if (dead || gen !== torrentGeneration || ended) return; clearTimeout(torrentTimer); ended = true; torBody.empty(); message(torBody, 'Поиск торрентов не ответил. Filmix работает независимо.'); action(torBody, 'Повторить поиск', '', loadTorrents); refreshFocus(); report('torrent_error'); }
            var timeout = torrentTimer = setTimeout(fail, 45000);
            var suffix = isSeries ? ' S' + ('0' + season).slice(-2) : '';
            var m = Object.assign({genres: []}, movie);
            m.genres = m.genres || [];
            m.title = m.title || m.name; m.original_title = m.original_title || m.original_name || m.title;
            try {
                L.Parser.get({movie: m, search: m.original_title + suffix, search_one: m.title + suffix, search_two: m.original_title + suffix, page: 1}, function (data) {
                    clearTimeout(timeout); if (dead || gen !== torrentGeneration || ended) return; ended = true;
                    var rows = sortTorrents(data && data.Results || []); torBody.empty();
                    tor.find('h2').text(isSeries ? 'Торренты · сезон ' + season : 'Торренты');
                    if (!rows.length) message(torBody, 'Раздач не найдено.');
                    rows.slice(0, 40).forEach(function (r) {
                        var bytes = Number(r.Size) || 0, size = bytes ? (bytes / 1073741824).toFixed(1) + ' ГБ' : '';
                        action(torBody, r.Title || 'Раздача', [size, 'Раздают: ' + (+r.Seeders || 0), r.Tracker || ''].filter(Boolean).join(' · '), function () { L.Torrent.back(activate); L.Torrent.start(r, movie); });
                    });
                    report('torrent_results', {count: rows.length}); refreshFocus();
                }, fail);
            } catch (e) { fail(); }
        }
        this.create = function () { return html; };
        this.render = function () { return html; };
        this.start = function () { activate(); if (!ready) { ready = true; loadFilmix(); loadTorrents(); if (self.activity) self.activity.loader(false); } };
        this.pause = function () { active = false; };
        this.stop = function () { active = false; };
        this.destroy = function () { dead = true; active = false; clearTimeout(torrentTimer); fx.destroy(); scroll.destroy(); html.remove(); };
    }
    function open(movie, context) { L.Activity.push({component: 'kvn_watch', title: 'Смотреть', movie: movie, season: context && context.season, page: 1}); }
    function attach(e) {
        if (e.type !== 'complite' || !e.data || !e.data.movie) return;
        function bind() {
            var body = e.body || (e.object && e.object.activity && e.object.activity.render()); if (!body) return;
            $(body).find('.button--play').each(function () {
                var btn = $(this); if (btn.data('kvn-watch-bound')) return;
                var events = $._data ? $._data(this, 'events') : null;
                var originals = events && events['hover:enter'] ? events['hover:enter'].slice() : [];
                btn.data('kvn-watch-bound', true).off('hover:enter').on('hover:enter.kvnwatch', function (event, ctx) {
                    if (enabled()) open(e.data.movie, ctx);
                    else originals.forEach(function (handler) { handler.handler.call(btn[0], event, ctx); });
                });
            });
        }
        setTimeout(bind, 50); setTimeout(bind, 500);
    }
    function init() {
        L = root.Lampa; $ = root.jQuery || root.$;
        if (!L || !$ || !L.Component || !L.Parser) { setTimeout(init, 500); return; }
        if (root.KVNWatch.ready) return; root.KVNWatch.ready = true;
        if (!L.Storage.get('kvn_watch_backup_v1', false)) L.Storage.set('kvn_watch_backup_v1', {created: Date.now(), plugins: L.Storage.get('plugins', []), enabled: L.Storage.get('kvn_watch_enabled', null)});
        $('<style>').text('.kvn-watch{height:100%;padding:1.4em 2em;box-sizing:border-box}.kvn-title{font-size:1.8em;font-weight:600;margin-bottom:.6em}.kvn-controls{display:flex;gap:.65em;margin-bottom:1em}.kvn-row{padding:.85em 1em;border-radius:.65em;background:rgba(255,255,255,.08);margin:.4em 0}.kvn-row.focus{background:#fff;color:#141820}.kvn-row-title{font-size:1.05em}.kvn-detail{opacity:.65;font-size:.8em;margin-top:.3em}.kvn-controls .kvn-row{font-size:.85em}.kvn-section{margin-bottom:1.6em}.kvn-section h2{font-size:1.3em;margin:0 0 .5em}.kvn-message{opacity:.72;padding:.6em 0 1em}.kvn-auth{line-height:1.5}').appendTo('head');
        $('<style>').text('.kvn-section h2{height:1.6em;line-height:1.6em;margin:0 0 .5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kvn-section .kvn-row{height:6.5em;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center}.kvn-section .kvn-row-title{line-height:1.15;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.kvn-section .kvn-detail{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}.kvn-account-badge{display:inline-block;margin-left:.65em;padding:.15em .45em;border-radius:.4em;background:#20262c;font-size:.85em}').appendTo('head');
        L.Component.add('kvn_watch', Screen); L.Listener.follow('full', attach);
        if (L.SettingsApi) {
            L.SettingsApi.addComponent({component: 'kvn_watch_settings', name: 'Простой просмотр', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 3v18l14-9z"/></svg>'});
            L.SettingsApi.addParam({component: 'kvn_watch_settings', param: {name: 'kvn_watch_enabled', type: 'trigger', default: true}, field: {name: 'Filmix и торренты по кнопке «Смотреть»', description: 'Выключите, чтобы вернуть прежнее меню источников.'}});
        }
        report('ready', {parser: !!L.Parser, torrent: !!L.Torrent, tokenPresent: !!token()});
    }
    root.KVNWatch = {version: VERSION, ready: false, open: function (movie) { open(movie); }};
    init();
})(typeof window === 'object' ? window : globalThis);
