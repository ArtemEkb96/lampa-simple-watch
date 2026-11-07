/* Simple Watch for Lampa. Local experimental plugin; no external telemetry. */
(function (root) {
    'use strict';
    var VERSION = '0.1.17';
    function movieKey(movie) { return (movie.source || 'tmdb') + ':' + (movie.original_name || movie.first_air_date || movie.name ? 'tv:' : 'movie:') + (movie.id || norm(movie.original_title || movie.original_name || movie.title || movie.name) + ':' + year(movie)); }
    function selectedEpisode(saved, requestedSeason, requestedEpisode) {
        var season = Number(requestedSeason) || Number(saved.season) || 1;
        return {season:season, episode:Number(requestedEpisode) || (season === Number(saved.season) ? Number(saved.episode) : 0) || 1};
    }
    function progressLabel(record) {
        if (!record) return '';
        if (record.manualSet ? record.manualDone : Number(record.percent) >= 90) return '✓ Просмотрено';
        if (Number(record.percent) > 0) return '▶ ' + Math.round(record.percent) + '%';
        return record.launched ? 'Запускали' : '';
    }
    function voiceMark(record, voice) {
        var last=(record.voices || {})['voice:'+voice];
        if(!last) return record.voice===voice ? {label:'Ранее выбирали эту озвучку',done:false} : null;
        var status=progressLabel(last) || 'Выбирали';
        return {label:status+(last.season ? ': сезон '+last.season+' · серия '+last.episode : ''),done:last.manualSet ? !!last.manualDone : Number(last.percent)>=90};
    }
    function voiceSelection(record,row) {
        var voices=Object.assign({},record.voices || {}),key='voice:'+row.voice,previous=voices[key];
        voices[key]=Object.assign({},previous && previous.season===row.season && previous.episode===row.episode ? previous : {},{season:row.season,episode:row.episode,selected:true});
        return voices;
    }
    function torrentBadges(row, movie) {
        var title = String(row.Title || ''), general = row.general || {}, info = row.info || {};
        var streams = Array.isArray(row.ffprobe) ? row.ffprobe : row.ffprobe && row.ffprobe.streams || [];
        var video = streams.filter(function (s) {return s.codec_type === 'video' && !/^(mjpeg|png)$/.test(s.codec_name || '') && !(s.disposition && s.disposition.attached_pic);})[0] || {};
        var text = String(general.resolution || info.quality || title);
        var badges = [], add = function (label, kind) {badges.push({label:label,kind:kind});};
        var width=Number(video.width || video.coded_width), height=Number(video.height || video.coded_height);
        var dimensions=String(general.resolution || '').match(/(\d{3,5})\s*[x×х]\s*(\d{3,5})/i);
        if(!width && !height && dimensions){width=+dimensions[1];height=+dimensions[2];}
        if (width || height) {
            add(width>=3800 || height>=2100 ? '4K' : width>=2500 || height>=1400 ? '1440p' : width>=1900 || height>=1000 ? '1080p' : width>=1260 || height>=700 ? '720p' : 'SD','quality');
            if(width && height) add(width+'×'+height,'quality');
        }
        else if (/\b(?:2160p?|4k|uhd)\b/i.test(text)) add('4K','quality');
        else if (/\b1080[pi]?\b/i.test(text) || Number(video.width) >= 1900) add('1080p','quality');
        else if (/\b720p?\b/i.test(text) || Number(video.width) >= 1260) add('720p','quality');
        else if (/\b1440p?\b/i.test(text)) add('1440p','quality');
        else if (/\b(?:SD|[345]80p?|576p?)\b/i.test(text)) add('SD','quality');
        var technical=JSON.stringify(video.side_data_list || []);
        if (width && height) {
            if (/HDR10\+|SMPTE2094|dynamic.hdr.plus/i.test(technical)) add('HDR10+','hdr');
            else if (video.color_transfer==='smpte2084') add('HDR10','hdr');
            else if (video.color_transfer==='arib-std-b67') add('HLG','hdr');
            if (/dovi|dolby.?vision/i.test(technical) || /dvhe|dvh1/.test(video.codec_tag_string || '')) add('Dolby Vision','hdr');
        }
        else {
        if (/HDR10\s*\+|HDR10Plus/i.test(title)) add('HDR10+','hdr');
        else if (/HDR10/i.test(title)) add('HDR10','hdr');
        else if (/\bHDR\b/i.test(title) || general.hdr) add('HDR','hdr');
        if (/Dolby\s*Vision|\bDV\b|\bDoVi\b/i.test(title)) add('Dolby Vision','hdr');
        if (/\bSDR\b/i.test(title)) add('SDR','neutral');
        }
        if (video.codec_name) add(({hevc:'HEVC',h264:'H.264',mpeg4:'MPEG-4',av1:'AV1',mpeg2video:'MPEG-2'})[video.codec_name] || video.codec_name.toUpperCase(),'codec');
        else if (/HEVC|[hx][ .-]?265/i.test(title)) add('HEVC','codec');
        else if (/AV1/i.test(title+' '+video.codec_name)) add('AV1','codec');
        else if (/[hx][ .-]?264|\bAVC\b/i.test(title+' '+video.codec_name)) add('H.264','codec');
        var rate = title.match(/(\d+(?:[.,]\d+)?)\s*(?:Mbps|Mbit\/s|Мбит\/с|Мб\/с)/i);
        var tags=video.tags || {}, bps=Number(video.bit_rate || tags.BPS || tags['BPS-eng'] || tags['BPS-en']);
        if (bps>0) add((bps/1e6).toFixed(1)+' Мбит/с видео','rate');
        else if (rate && !width) add(rate[1].replace(',','.')+' Мбит/с','rate');
        else if (!(movie.name || movie.original_name || movie.first_air_date) && Number(movie.runtime)>0 && Number(row.Size)>0) {
            add('≈ '+(Number(row.Size)*8/(Number(movie.runtime)*60*1e6)).toFixed(1)+' Мбит/с','rate');
        }
        if (!badges.some(function (b) {return b.kind === 'quality';})) add('Качество не указано','neutral');
        return badges;
    }
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
    function torrentInfoHash(row) {
        var hashes=[];
        magnetValues(row,'xt').forEach(function(xt) {
            var m=/^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.exec(xt);
            if(!m) return;
            var hash=m[1].toLowerCase();
            if(hash.length===32) {
                var bits=0,value=0,hex='';
                hash.toUpperCase().split('').forEach(function(c) {
                    value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c); bits+=5;
                    if(bits>=8) { bits-=8; hex+=('0'+((value>>>bits)&255).toString(16)).slice(-2); }
                });
                hash=hex;
            }
            if(hashes.indexOf(hash)<0) hashes.push(hash);
        });
        return hashes.length===1 ? hashes[0] : null;
    }
    function magnetValues(row,key) {
        var values=[];
        [row.MagnetUri,row.magnet,row.downloadUrl,row.Link,row.Guid].forEach(function(uri) {
            if(!/^magnet:\?/i.test(uri || '')) return;
            String(uri).slice(8).split('&').forEach(function(part) {
                var at=part.indexOf('=');
                if(part.slice(0,at).toLowerCase()!==key) return;
                try { var v=decodeURIComponent(part.slice(at+1)); if(values.indexOf(v)<0) values.push(v); } catch(e) {}
            });
        });
        return values;
    }
    function sortTorrents(rows) {
        var seen=Object.create(null), merged=[];
        rows.forEach(function(r) {
            var hash=torrentInfoHash(r), key=hash && 'btih:'+hash, prev=key && seen[key];
            if(prev) {
                prev._kvnMembers=prev._kvnMembers.concat(r._kvnMembers || [r]);
                if(seedCount(prev)===null && seedCount(r)!==null) {prev.Seeders=r.Seeders; prev.Peers=r.Peers;}
            }
            else {
                var copy=Object.assign({},r,{_kvnMembers:(r._kvnMembers || [r]).slice()});
                merged.push(copy); if(key) seen[key]=copy;
            }
        });
        return merged.sort(function(a,b) {return (seedCount(b) || 0)-(seedCount(a) || 0);});
    }
    // Tracker titles are inconsistent. Reject only clearly identified wrong seasons or episodes.
    function torrentMatch(title, wantedSeason, wantedEpisode) {
        var text=String(title || '').toLowerCase().replace(/ё/g,'е'), seasons=[], episodes=[], m;
        function addRange(list,a,b) { a=Number(a); b=b ? Number(b) : a; if(a>0 && b>=a && b-a<=30) for(var n=a;n<=b;n++) if(list.indexOf(n)<0) list.push(n); }
        var rx=/(?:^|[^a-zа-я0-9])s(\d{1,2})(?:\s*[-–]\s*s?(\d{1,2}))?(?=$|[^a-zа-я0-9]|e\d)/gi;
        while((m=rx.exec(text))) addRange(seasons,m[1],m[2]);
        rx=/(?:^|[^a-zа-я0-9])(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*(?:-?\s*(?:й|ый|ий|го|йо)\s*)?сезон(?:а|ы|ов)?/gi;
        while((m=rx.exec(text))) addRange(seasons,m[1],m[2]);
        rx=/сезон(?:а|ы|ов)?\s*[:№#]?\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/gi;
        while((m=rx.exec(text))) {
            // In '1 сезон: 1-10 серии', numbers after the colon are episodes.
            if (!/\d(?:\s*-?\s*(?:й|ый|ий|го|йо))?\s*$/.test(text.slice(0,m.index))) addRange(seasons,m[1],m[2]);
        }
        rx=/(?:^|[^a-zа-я0-9])(\d{1,2})\s*(?:-?\s*(?:й|ый|ий|го)\s*)?сезон(?:а)?\s*[:№#]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*сер(?:ия|ии|ий)/gi;
        while((m=rx.exec(text))) if(Number(m[1])===Number(wantedSeason)) addRange(episodes,m[2],m[3]);
        rx=/(?:^|[^a-zа-я0-9])(\d{1,2})[xх](\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?(?=$|[^0-9])/gi;
        while((m=rx.exec(text))) { addRange(seasons,m[1]); if(Number(m[1])===Number(wantedSeason)) addRange(episodes,m[2],m[3]); }
        rx=/(?:^|[^a-zа-я0-9])s(\d{1,2})e(\d{1,3})(?:\s*[-–]\s*e?(\d{1,3}))?/gi;
        while((m=rx.exec(text))) if(Number(m[1])===Number(wantedSeason)) addRange(episodes,m[2],m[3]);
        // Compound episode lists such as S02E01E03 are ambiguous; never hide them.
        if(/s\d{1,2}e\d{1,3}(?:e\d{1,3}|\s*[+,/]\s*e\d{1,3})/i.test(text)) episodes=[];
        // Comma-separated season lists need inspection rather than an unsafe exclusion.
        var listMatch=/сезон(?:а|ы|ов)?\s*[:№#]?\s*\d{1,2}\s*[,/+]\s*\d{1,2}/i.exec(text);
        if(listMatch && !/\d(?:\s*-?\s*(?:й|ый|ий|го|йо))?\s*$/.test(text.slice(0,listMatch.index))) return 'unknown';
        if(seasons.length && seasons.indexOf(Number(wantedSeason))<0) return 'other';
        if(episodes.length && episodes.indexOf(Number(wantedEpisode))<0) return 'other';
        return seasons.length ? 'match' : 'unknown';
    }
    function seedCount(row) {
        var v=row && row.Seeders;
        if(v===undefined || v===null || v==='' || !isFinite(Number(v)) || Number(v)<0) return null;
        return Math.floor(Number(v));
    }
    function displayTorrents(rows, record, identify, series, season, episode) {
        var matches=[], unknown=[], excluded=0;
        sortTorrents(rows).forEach(function(row) {
            var status=series ? torrentMatch(row.Title,season,episode) : 'match';
            if(status==='other') excluded++;
            else (status==='match' ? matches : unknown).push(row);
        });
        var ranked=matches.concat(unknown).map(function(row,index) {
            var stats=freshStats(row), count=stats.length ? stats[0].seeders : seedCount(row);
            return {row:row,count:count===null ? -1 : count,index:index};
        }).sort(function(a,b){return b.count-a.count || a.index-b.index;}).map(function(item){return item.row;});
        return {rows:prioritizeTorrents(ranked,record,identify), excluded:excluded};
    }
    function usedTorrent(record,identity) {return record.torrent===identity || !!(record.torrentsUsed || {})[identity];}
    function prioritizeTorrents(rows,record,identify) {
        var latest=[],used=[],other=[];
        rows.forEach(function(row){
            var ids=torrentIdentities(row,identify);
            (record.torrent && ids.indexOf(record.torrent)>=0 ? latest : ids.some(function(id){return usedTorrent(record,id);}) ? used : other).push(row);
        });
        return latest.concat(used,other);
    }
    function torrentIdentities(row,identify) {
        var ids=(row._kvnMembers || [row]).map(identify), hash=torrentInfoHash(row);
        if(hash) ids.push('btih:'+hash);
        return ids;
    }
    function freshStats(row) {
        return (row._kvnTracker || []).filter(function(s){return validCount(s.seeders) && s.at>0;})
            .sort(function(a,b){return b.seeders-a.seeders;});
    }
    function validCount(v) {return typeof v==='number' && isFinite(v) && v>=0 && Math.floor(v)===v;}
    function seedLabel(row) {
        var stats=freshStats(row);
        if(stats.length) return stats.map(function(s){return 'Трекер '+s.host+': раздают '+s.seeders;}).join(' · ');
        var count=seedCount(row);
        return count===null ? 'Нет данных' : 'Раздают по данным сайта: '+count;
    }
    function trackerName(host) {
        var name=String(host || '').toLowerCase(), known={
            'opentor.net':'OpenTor','tracker.opentrackr.org':'OpenTrackr','open.stealth.si':'Stealth',
            'tracker.torrent.eu.org':'Torrent.eu','torrent.by':'Torrent.by','tracker-udp.gbitt.info':'GBitt',
            'tracker.renfei.net':'Renfei','exodus.desync.com':'Desync','evan.im':'Evan',
            'torrent.tracker.durukanbal.com':'Durukan','ipv4.tracker.harry.lu':'Harry'
        };
        if(known[name]) return known[name];
        name=name.replace(/^(?:(?:www|tracker(?:-udp)?|udp|open|ipv[46])\.)+/,'').split('.')[0] || 'Трекер';
        return name.length>16 ? name.slice(0,15)+'…' : name;
    }
    function seedBadges(row) {
        var stats=freshStats(row);
        if(stats.length) return stats.map(function(s) {
            return {count:s.seeders,label:trackerName(s.host),kind:s.seeders>0 ? 'live' : 'neutral',title:s.host};
        });
        var count=seedCount(row);
        return [{count:count,label:count===null ? 'Нет данных' : 'Сайт',kind:count>0 ? 'site' : 'neutral',
            title:count===null ? 'Нет данных' : 'По данным сайта'}];
    }
    // Only use tracker addresses supplied in magnets; never invent a UDP/HTTP mirror.
    function trackerSpecs(row,includeUDP) {
        var result=[],seen=Object.create(null);
        (row._kvnMembers || [row]).forEach(function(member) {
            magnetValues(member,'tr').forEach(function(address) {
                try {
                    var url=new URL(address);
                    if(!/^(https?|wss?|udp):$/.test(url.protocol) || url.username || url.password) return;
                    if(url.protocol==='udp:' && (!includeUDP || !url.port || url.search)) return;
                    if(includeUDP && /(?:^localhost$|\.local$)/i.test(url.hostname)) return;
                    if(/^http/.test(url.protocol)) {
                        if(!/\/announce[^/]*$/.test(url.pathname)) return;
                        url.pathname=url.pathname.replace(/\/announce([^/]*)$/,'/scrape$1');
                    }
                    url.hash='';
                    if(seen[url.href]) return; seen[url.href]=true;
                    result.push({url:url.href,host:url.hostname.replace(/^\[|\]$/g,''),ws:/^ws/.test(url.protocol),udp:url.protocol==='udp:'});
                } catch(e) {}
            });
        });
        if(includeUDP) result.sort(function(a,b){return Number(b.udp)-Number(a.udp);});
        return result.slice(0,3);
    }
    function hashBinary(hash) {return hash.replace(/../g,function(pair){return String.fromCharCode(parseInt(pair,16));});}
    function scrapeUrl(spec,hashes) {
        return spec.url+(spec.url.indexOf('?')<0 ? '?' : '&')+hashes.map(function(hash){
            return 'info_hash='+hash.match(/../g).map(function(pair){return '%'+pair;}).join('');
        }).join('&');
    }
    // Bounded bencode reader, keeping binary dictionary keys byte-for-byte.
    function decodeScrape(buffer) {
        var bytes=new Uint8Array(buffer),pos=0,nodes=0;
        if(!bytes.length || bytes.length>262144) throw Error('scrape size');
        function read(depth) {
            if(depth>12 || ++nodes>20000 || pos>=bytes.length) throw Error('scrape bounds');
            var marker=bytes[pos++],value,end;
            if(marker===100 || marker===108) {
                value=marker===100 ? Object.create(null) : [];
                while(bytes[pos]!==101) {
                    if(marker===100) {var key=read(depth+1); if(typeof key!=='string') throw Error('scrape key'); value[key]=read(depth+1);}
                    else value.push(read(depth+1));
                    if(pos>=bytes.length) throw Error('scrape end');
                }
                pos++; return value;
            }
            if(marker===105) {
                end=pos; while(end<bytes.length && bytes[end]!==101) end++;
                if(end===bytes.length) throw Error('scrape int');
                var text=''; while(pos<end) text+=String.fromCharCode(bytes[pos++]); pos++;
                if(!/^(0|-?[1-9]\d*)$/.test(text) || !isFinite(Number(text))) throw Error('scrape int');
                return Number(text);
            }
            var length=String.fromCharCode(marker);
            while(pos<bytes.length && bytes[pos]!==58 && length.length<8) length+=String.fromCharCode(bytes[pos++]);
            if(bytes[pos++]!==58 || !/^(0|[1-9]\d*)$/.test(length)) throw Error('scrape string');
            end=pos+Number(length); if(end>bytes.length) throw Error('scrape string bounds');
            value=''; while(pos<end) value+=String.fromCharCode(bytes[pos++]); return value;
        }
        var data=read(0); if(pos!==bytes.length) throw Error('scrape trailing'); return data;
    }
    function scrapeCounts(data,hashes) {
        var result=Object.create(null);
        if(!data || data['failure reason'] || data.failure_reason || !data.files) return result;
        hashes.forEach(function(hash) {
            var stat=data.files[hashBinary(hash)];
            if(stat && validCount(stat.complete)) result[hash]=stat.complete;
        });
        return result;
    }
    function probeTracker(env,spec,hashes,done,budget) {
        budget=Math.max(1,Math.min(4000,budget || 4000));
        if(spec.udp) {done({});return function(){};}
        var ended=false,channel,timer=env.setTimeout(function(){finish({});},budget);
        function cancel() {
            env.clearTimeout(timer);
            if(channel) {channel.onload=channel.onerror=channel.onabort=channel.onclose=channel.onmessage=channel.onopen=channel.onprogress=channel.ontimeout=null;
                try {if(spec.ws) channel.close(); else channel.abort();} catch(e) {}}
        }
        function finish(counts) {if(ended) return; ended=true; cancel(); done(counts);}
        try {
            if(spec.ws) {
                channel=new env.WebSocket(spec.url);
                channel.onopen=function(){channel.send(JSON.stringify({action:'scrape',info_hash:hashes.map(hashBinary)}));};
                channel.onmessage=function(event){
                    try {if(typeof event.data!=='string' || event.data.length>262144) return finish({});
                        var data=JSON.parse(event.data); if(data.action==='scrape') finish(scrapeCounts(data,hashes));
                    } catch(e) {finish({});}
                };
                channel.onerror=channel.onclose=function(){finish({});};
            } else {
                channel=new env.XMLHttpRequest(); channel.open('GET',scrapeUrl(spec,hashes),true); channel.responseType='arraybuffer'; channel.timeout=budget;
                channel.onprogress=function(event){if(event.loaded>262144) finish({});};
                channel.onload=function(){try {finish(channel.status===200 ? scrapeCounts(decodeScrape(channel.response),hashes) : {});} catch(e) {finish({});}};
                channel.onerror=channel.ontimeout=channel.onabort=function(){finish({});}; channel.send();
            }
        } catch(e) {finish({});}
        return function(){ended=true; cancel();};
    }
    function trackerBackend(L) {
        try {
            var storage=L.Storage,one=storage.get('torrserver_url',''),two=storage.get('torrserver_url_two','');
            var raw=L.Torserver && L.Torserver.url ? L.Torserver.url() : storage.field('torrserver_use_link')==='two' ? two || one : one || two;
            if(!raw) return null;
            var url=new URL(L.Utils.checkEmptyUrl(raw));
            if(!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) return null;
            return url.href.replace(/\/+$/,'');
        } catch(e) {return null;}
    }
    function trackerHeaders(L,env) {
        var headers={'Content-Type':'application/json',Accept:'application/json'};
        if(L.Storage.field('torrserver_auth')) {
            var password=L.Storage.value ? L.Storage.value('torrserver_password') : L.Storage.get('torrserver_password','');
            var text=encodeURIComponent(L.Storage.get('torrserver_login','')+':'+password).replace(/%([0-9A-F]{2})/g,function(_,h){return String.fromCharCode(parseInt(h,16));});
            headers.Authorization='Basic '+env.btoa(text);
        }
        return headers;
    }
    // One capability discovery per opening; all HTTP/UDP batches use the selected LT.
    function createTrackerProbe(L,env) {
        var base=trackerBackend(L),state=base ? 'new' : 'absent',waiting=[],capNetwork,capTimer;
        var now=env.now || Date.now;
        function discovered(available) {
            if(state!=='loading') return;
            state=available ? 'ready' : 'absent';env.clearTimeout(capTimer);if(capNetwork) capNetwork.clear();
            var callbacks=waiting;waiting=[];callbacks.forEach(function(fn){fn();});
        }
        function discover(next) {
            if(state==='ready' || state==='absent') return next();
            waiting.push(next);if(state==='loading') return;state='loading';
            capTimer=env.setTimeout(function(){discovered(false);},700);
            try {
                capNetwork=new L.Reguest();capNetwork.timeout(700);
                capNetwork.native(base+'/kvn/trackers/capabilities',function(data){
                    discovered(!!(data && data.version===1 && Array.isArray(data.protocols) && data.protocols.indexOf('udp')>=0));
                },function(){discovered(false);},null,{headers:trackerHeaders(L,env)});
            } catch(e) {discovered(false);}
        }
        function probe(spec,hashes,done,budget) {
            var ended=false,network,stopDirect,started=now();budget=Math.max(1,Math.min(4000,budget || 4000));
            var timer=env.setTimeout(function(){finish({});},budget);
            function clean() {env.clearTimeout(timer);if(network) network.clear();if(stopDirect) stopDirect();}
            function finish(counts) {if(ended) return;ended=true;clean();done(counts);}
            function run() {
                if(ended) return;
                var remaining=Math.floor(budget-(now()-started));if(remaining<1) return finish({});
                if(spec.ws || state!=='ready') {
                    if(spec.udp) return finish({});
                    stopDirect=probeTracker(env,spec,hashes,finish,remaining);return;
                }
                try {
                    network=new L.Reguest();network.timeout(remaining);
                    var payload=JSON.stringify({version:1,tracker:spec.url,hashes:hashes,budget_ms:remaining});
                    network.native(base+'/kvn/trackers/scrape',function(data){
                        var counts=Object.create(null),seen=Object.create(null);
                        if(data && data.version===1 && data.host===spec.host && Array.isArray(data.results) && data.results.length<=20) {
                            data.results.forEach(function(r){if(r && r.status==='ok' && hashes.indexOf(r.hash)>=0 && validCount(r.seeders) && r.checked_at>0) {
                                if(seen[r.hash]) {delete counts[r.hash];} else {counts[r.hash]=r.seeders;} seen[r.hash]=true;
                            }});
                        }
                        finish(counts);
                    },function(){finish({});},payload,{headers:trackerHeaders(L,env)});
                } catch(e) {finish({});}
            }
            if(spec.ws) run();else discover(run);
            return function(){ended=true;clean();};
        }
        probe.cancel=function(){waiting=[];if(capNetwork) capNetwork.clear();env.clearTimeout(capTimer);state='absent';};
        return probe;
    }
    // All callbacks belong to one collection. Opening/cancelling seals it permanently.
    function createTorrentCollection(options) {
        var rows=[],stats=Object.create(null),seen=Object.create(null),queue=[],stops=[],running=0,pending=options.searches.length;
        var sealed=false,started=false,launching=false,timer,successes=0,failures=0,deadline;
        function rememberStop(stop) {if(typeof stop==='function') {if(sealed) stop(); else stops.push(stop);}}
        function cancelWork() {options.clearTimeout(timer); stops.forEach(function(stop){try {stop();} catch(e) {}});if(options.probe.cancel) options.probe.cancel();}
        function snapshot() {
            return sortTorrents(rows).map(function(row) {
                return Object.assign({},row,{_kvnTracker:(stats[torrentInfoHash(row)] || []).map(function(s){return Object.assign({},s);})});
            });
        }
        function show() {if(sealed) return; sealed=true; var result=snapshot(); cancelWork(); options.ready(result,{successes:successes,failures:failures,pending:pending});}
        function complete() {if(!launching && !pending && !running && !queue.length) show();}
        function pump() {
            if(sealed) return;
            while(running<3 && queue.length) {
                var budget=Math.min(4000,deadline-options.now());if(budget<=0) {show();return;}
                (function(task) {
                    running++; var answered=false;
                    function finish(counts) {
                        if(sealed || answered) return; answered=true;
                        task.hashes.forEach(function(hash) {if(validCount(counts[hash])) {
                            (stats[hash] || (stats[hash]=[])).push({host:task.spec.host,seeders:counts[hash],at:options.now()});
                        }});
                        running--; pump();
                    }
                    try {rememberStop(options.probe(task.spec,task.hashes,finish,budget));} catch(e) {finish({});}
                })(queue.shift());
            }
            complete();
        }
        function enqueue() {
            var groups=Object.create(null);
            options.candidates(sortTorrents(rows)).slice(0,80).forEach(function(row) {
                var hash=torrentInfoHash(row); if(!hash) return;
                trackerSpecs(row,options.includeUDP).forEach(function(spec) {
                    var key=spec.url+'|'+hash; if(seen[key]) return; seen[key]=true;
                    var group=groups[spec.url] || (groups[spec.url]={spec:spec,hashes:[]}); group.hashes.push(hash);
                });
            });
            Object.keys(groups).forEach(function(key) {
                var group=groups[key]; for(var i=0;i<group.hashes.length;i+=20) queue.push({spec:group.spec,hashes:group.hashes.slice(i,i+20)});
            });
        }
        return {
            start:function() {
                if(started || sealed) return; started=true; launching=true; deadline=options.now()+15000;timer=options.setTimeout(show,15000);
                options.searches.forEach(function(search) {
                    if(sealed) return;
                    var answered=false;
                    function finish(items) {
                        if(sealed || answered) return; answered=true; pending--;
                        if(Array.isArray(items)) {successes++; rows=rows.concat(items); enqueue();} else failures++;
                        pump();
                    }
                    try {rememberStop(search(finish));} catch(e) {finish(null);}
                });
                launching=false; complete();
            },
            show:show,
            cancel:function(){if(sealed) return; sealed=true; cancelWork();}
        };
    }
    function parserSearches(storage,utils,makeRequest,fallback,params) {
        var type=storage.field('parser_torrent_type') || 'jackett';
        if(type!=='jackett' && type!=='prowlarr') return [function(done){fallback(params,function(data){done(data && data.Results);},function(){done(null);});}];
        var links=[],seen=Object.create(null);
        ['', '_two'].forEach(function(suffix,rank) {
            var raw=String(storage.field(type+'_url'+suffix) || '').trim(); if(!raw) return;
            if(type==='jackett') raw=raw.replace('jacred.xyz','jac.red');
            var base=utils.checkEmptyUrl(raw).replace(/\/+$/,''),key=storage.field(type+'_key'+suffix) || '';
            var id=base+'|'+key; if(seen[id]) return; seen[id]=true;
            links.push({base:base,key:key,rank:rank});
        });
        return links.map(function(link) {return function(done) {
            var network=makeRequest(),m=params.movie,url;
            if(type==='jackett') {
                url=link.base+'/api/v2.0/indexers/'+(storage.field('jackett_interview')==='healthy' ? 'status:healthy' : 'all')+'/results?apikey='+encodeURIComponent(link.key)+'&Query='+encodeURIComponent(params.search);
                url+='&title='+encodeURIComponent(m.title)+'&title_original='+encodeURIComponent(m.original_title);
                url+='&year='+encodeURIComponent(String(m.first_air_date || m.release_date || '0000').slice(0,4));
                url+='&is_serial='+(m.original_name ? '2' : '1')+'&genres='+encodeURIComponent((m.genres || []).map(function(g){return g.name;}).join(','));
                url+='&Category[]='+(m.number_of_seasons>0 ? '5000' : '2000');
                if(/^(ja|zh)$/.test(m.original_language || '') && (m.genres || []).some(function(g){return g.id===16;})) url+=',5070';
            } else {
                url=link.base+'/api/v1/search?apikey='+encodeURIComponent(link.key)+'&query='+encodeURIComponent(params.search)+'&type='+(m.original_name ? 'tvsearch' : 'search')+'&categories='+(m.number_of_seasons>0 ? '5000' : '2000');
                if(/^(ja|zh)$/.test(m.original_language || '') && (m.genres || []).some(function(g){return g.id===16;})) url+='&categories=5070';
            }
            network.timeout(15000);
            network.native(url,function(data) {
                var items;
                if(type==='jackett') items=data && data.Results;
                else if(Array.isArray(data)) items=data.filter(function(r){return r.protocol==='torrent';}).map(function(r){return {
                    Title:r.title,Tracker:r.indexer,Size:r.size,PublishDate:r.publishDate,Seeders:r.seeders,Peers:r.leechers,MagnetUri:r.magnetUrl || (/^magnet:/i.test(r.downloadUrl || '') ? r.downloadUrl : ''),Link:r.downloadUrl
                };});
                if(!Array.isArray(items)) return done(null);
                done(items.filter(function(r){return r && typeof r==='object' && !Array.isArray(r);}).map(function(r){return Object.assign({},r,{
                    hash:utils.hash(r.Title),size:utils.bytesToSize(r.Size),PublisTime:utils.strToTime(r.PublishDate),source_rank:link.rank
                });}));
            },function(){done(null);});
            return function(){network.clear();};
        };});
    }
    var pure = {norm: norm, year: year, match: match, streams: streams, cap: cap, sortTorrents: sortTorrents, torrentInfoHash:torrentInfoHash, movieKey:movieKey, selectedEpisode:selectedEpisode, progressLabel:progressLabel, torrentBadges:torrentBadges,voiceMark:voiceMark,voiceSelection:voiceSelection,prioritizeTorrents:prioritizeTorrents,usedTorrent:usedTorrent,torrentMatch:torrentMatch,seedCount:seedCount,displayTorrents:displayTorrents,torrentIdentities:torrentIdentities,seedLabel:seedLabel,seedBadges:seedBadges,trackerName:trackerName,trackerSpecs:trackerSpecs,scrapeUrl:scrapeUrl,hashBinary:hashBinary,decodeScrape:decodeScrape,scrapeCounts:scrapeCounts,probeTracker:probeTracker,createTorrentCollection:createTorrentCollection,parserSearches:parserSearches,createTrackerProbe:createTrackerProbe,trackerBackend:trackerBackend,trackerHeaders:trackerHeaders};
    if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
    if (root.KVNWatch) return;
    var L, $, API = 'http://filmixapp.cyou/api/v2/', watchCards = new WeakMap();
    function report() {} // Release builds do not send diagnostic events.
    function enabled() { return L.Storage.get('kvn_watch_enabled', true) !== false; }
    var trackedTimelines = {}, pendingTorrent = null;
    function historyStorage(movie) {
        var permit = L.Account && L.Account.Permit;
        var profile = permit && permit.sync && permit.account && permit.account.profile ? permit.account.profile.id : 'local';
        return 'kvn_watch_history_v1:' + profile + ':' + movieKey(movie);
    }
    function historyRead(key) { return L.Storage.get(key, {episodes:{}}); }
    function historyWrite(key, changes) {
        var record = historyRead(key); Object.keys(changes).forEach(function (k) {record[k]=changes[k];});
        record.updated=Date.now(); L.Storage.set(key,record); return record;
    }
    function rememberPlayback(data) {
        var movie=data && data.card;
        if (!movie) return;
        var key=historyStorage(movie), old=historyRead(key);
        if (!data.kvnWatch && (!pendingTorrent || pendingTorrent.key!==key)) return;
        var s=Number(data.season) || Number(data.timeline && data.timeline.season) || 0;
        var e=Number(data.episode) || Number(data.timeline && data.timeline.episode) || 0;
        if ((movie.original_name || movie.first_air_date || movie.name) && (!s || !e)) return;
        var ep=s+':'+e, episodes=old.episodes || {};
        episodes[ep]=Object.assign({},episodes[ep],{launched:true,source:data.kvnWatch ? 'Filmix' : 'Торренты'});
        historyWrite(key,{season:s,episode:e,episodes:episodes,source:data.kvnWatch ? 'Filmix' : 'Торренты'});
        var voice=data.kvnWatch && data.kvnVoice;
        if(voice) {
            var voices=old.voices || {}, previous=voices['voice:'+voice];
            voices['voice:'+voice]=Object.assign({},previous && previous.season===s && previous.episode===e ? previous : {},{season:s,episode:e,launched:true});
            historyWrite(key,{voices:voices});
        }
        if (data.timeline && data.timeline.hash) trackedTimelines[data.timeline.hash]={key:key,episode:ep,voice:voice};
    }
    function metadataIdentity(row) {return String(L.Utils.hash(row.MagnetUri || row.Guid || row.Link || row.Title));}
    function cachedMedia(row) {
        var cache=L.Storage.get('mediainfo_cache_v2',{}), keys=[row.Link,row.link,row.MagnetUri,row.url];
        for(var i=0;i<keys.length;i++) {
            var rows=keys[i] && cache[keys[i]];
            if(Array.isArray(rows) && rows.length && rows.length<=16) return rows.filter(function(r){return r && r.c==='v' && typeof r.t==='string';}).map(function(r){return {label:r.t.slice(0,200),kind:'quality'};});
        }
        return [];
    }
    function rowBadges(row,movie) {
        if(row.ffprobe && (Array.isArray(row.ffprobe) ? row.ffprobe.length : row.ffprobe.streams && row.ffprobe.streams.length)) return torrentBadges(row,movie);
        var cached=cachedMedia(row);
        if(cached.length) return cached;
        var learned=L.Storage.get('kvn_watch_media_v1:'+metadataIdentity(row),{});
        if(learned.badges && learned.badges.length) return learned.badges.concat([{label:learned.fileLabel || 'Из выбранного файла',kind:'neutral'}]);
        return torrentBadges(row,movie);
    }
    function installHistory() {
        if (L.Player && L.Player.listener) L.Player.listener.follow('external',function(data){rememberPlayback(data.data || data);});
        if (L.Listener) L.Listener.follow('torrent_file',function(event){
            var data=event.element;
            if(!data || !pendingTorrent || !data.card || historyStorage(data.card)!==pendingTorrent.key) return;
            if(event.type==='onenter') rememberPlayback(data);
            if(event.type==='render' && event.item) {
                // Capture the file chosen with the remote, even before an external player opens.
                event.item.on('hover:enter.kvnHistory',function(){rememberPlayback(data);});
            }
            if(event.type!=='onenter' || !pendingTorrent.identity) return;
            var rows=[];
            if(event.item) event.item.find('.mi-v').each(function(){var t=$(this).text();if(t) rows.push({label:t.slice(0,200),kind:'quality'});});
            if(!rows.length && data.ffprobe) rows=torrentBadges({ffprobe:data.ffprobe},data.card);
            if(rows.length) L.Storage.set('kvn_watch_media_v1:'+pendingTorrent.identity,{badges:rows.slice(0,8),fileLabel:data.episode ? 'С'+data.season+' · серия '+data.episode : 'Из выбранного файла'});
        });
        if (L.Player && L.Player.listener) L.Player.listener.follow('create', function (event) {
            rememberPlayback(event.data || event);
        });
        if (L.Timeline && L.Timeline.listener) L.Timeline.listener.follow('update', function (event) {
            var data=event.data || {}, target=trackedTimelines[data.hash];
            if (!target || !data.road) return;
            var record=historyRead(target.key), episodes=record.episodes || {};
            episodes[target.episode]=Object.assign({},episodes[target.episode],{percent:data.road.percent,time:data.road.time,duration:data.road.duration});
            historyWrite(target.key,{episodes:episodes});
            var voices=record.voices || {}, last=voices['voice:'+target.voice];
            if(target.voice && last && last.season+':'+last.episode===target.episode) {
                Object.assign(last,{percent:data.road.percent,time:data.road.time,duration:data.road.duration});
                historyWrite(target.key,{voices:voices});
            }
        });
    }
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
        var historyKey=historyStorage(movie), saved=historyRead(historyKey), selection=selectedEpisode(saved,object.season,object.episode);
        var season = selection.season, episode = selection.episode, isSeries = !!(movie.name || movie.first_air_date || movie.original_name);
        var fx = new Filmix(), generation = 0, torrentGeneration = 0, allStreams = [], torrentRows = null, post = null, profile = null, torrentCollection, torrentSummary, accountButton, accountState = 'checking';
        var html = $('<div class="kvn-watch"></div>'), heading = $('<div class="kvn-heading"></div>').appendTo(html);
        $('<div class="kvn-title"></div>').text(movie.title || movie.name || 'Смотреть').appendTo(heading);
        var controls = $('<div class="kvn-controls"></div>').appendTo(heading);
        var progress = $('<div class="kvn-progress"></div>').appendTo(heading);
        var scroll = new L.Scroll({mask: true, over: true}); html.append(scroll.render()); scroll.minus(heading);
        var film = $('<section class="kvn-section"><h2>Filmix</h2></section>'), tor = $('<section class="kvn-section"><h2>Торренты</h2></section>');
        tor.addClass('kvn-torrents');
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
        function episodeId() {return isSeries ? season+':'+episode : '0:0';}
        function remember(changes) {historyWrite(historyKey,Object.assign({season:season,episode:episode},changes || {}));}
        function updateProgress() {
            var record=historyRead(historyKey), ep=(record.episodes || {})[episodeId()];
            progress.text([isSeries ? 'Сезон '+season+' · серия '+episode : '',progressLabel(ep),ep && ep.source ? ep.source : record.source ? 'Последний источник: '+record.source : ''].filter(Boolean).join(' · '));
            progress.toggleClass('kvn-done',progressLabel(ep)==='✓ Просмотрено');
        }
        function episodeTitle(s,e) {var item=(historyRead(historyKey).episodes || {})[s+':'+e];return 'Серия '+e+(progressLabel(item) ? ' · '+progressLabel(item) : '');}
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
                    choose('Сезон', ss.map(function (s) { return {title: 'Сезон ' + s, value: s}; }), function (v) { season = v.value; episode = 1; remember(); drawControls(); drawStreams(); loadTorrents(); });
                });
                action(controls, 'Серия ' + episode, '', function () {
                    var es = allStreams.filter(function (r) { return r.season === season; }).map(function (r) { return r.episode; }).filter(function (e,i,a) { return e > 0 && a.indexOf(e) === i; }).sort(function (a,b) {return a-b;});
                    if (!es.length) { L.Noty.show('Список серий появится после загрузки Filmix. В торрентах серия выбирается внутри раздачи.'); return; }
                    choose('Серия', es.map(function (e) { return {title: episodeTitle(season,e), value: e}; }), function (v) { episode = v.value; remember(); drawControls(); drawStreams(); if (torrentRows) renderTorrents(); });
                });
            }
            action(controls, 'Отметка просмотра', '', function () {
                choose('Отметка просмотра', [{title:'Отметить просмотренным',done:true},{title:'Отметить непросмотренным',done:false}], function (v) {
                    var record=historyRead(historyKey), episodes=record.episodes || {};
                    episodes[episodeId()]=Object.assign({},episodes[episodeId()],{manualDone:v.done,manualSet:true});
                    var voices=record.voices || {}, last=voices['voice:'+record.voice];
                    if(record.source==='Filmix' && last && last.season===season && last.episode===episode) Object.assign(last,{manualDone:v.done,manualSet:true});
                    historyWrite(historyKey,{episodes:episodes,voices:voices});updateProgress();updateVoiceMarks();
                });
            });
            action(controls, 'Обновить', '', function () { loadFilmix(); loadTorrents(); }); updateProgress();refreshFocus();
        }
        function playFilmix(row) {
            var variants = allStreams.filter(function (r) { return r.voice === row.voice && r.season === row.season && r.episode === row.episode; });
            var q = {}; variants.forEach(function (r) { q[r.quality + 'p'] = r.url; });
            var entry = {title: (movie.title || movie.name) + (row.season ? ' · ' + row.season + ' сезон, ' + row.episode + ' серия' : '') + ' · ' + row.voice, url: row.url, quality: q, card:movie,season:row.season,episode:row.episode,kvnWatch:true,kvnVoice:row.voice};
            remember({source:'Filmix',voice:row.voice,quality:row.quality,voices:voiceSelection(historyRead(historyKey),row)});
            updateVoiceMarks();
            if (L.Timeline) {
                var name=movie.original_title || movie.original_name || movie.title || movie.name;
                var hash=L.Utils.hash(row.season ? [row.season,row.episode,name].join('') : name);
                entry.timeline=L.Timeline.view(hash,L.Timeline.link ? L.Timeline.link(movie,row.season,row.episode) : null);
            }
            if (movie.id) L.Favorite.add('history', movie, 100);
            L.Player.play(entry); L.Player.playlist([entry]);
        }
        function updateVoiceMarks() {
            var record=historyRead(historyKey);
            filmBody.find('.kvn-voice-mark').each(function(){
                var item=$(this),mark=voiceMark(record,item.data('voice'));
                item.text(mark ? mark.label : '').toggle(!!mark).toggleClass('kvn-tag-history',!!(mark && mark.done)).toggleClass('kvn-tag-quality',!!(mark && !mark.done));
            });
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
                var tile=action(filmBody, r.voice, variants.map(function (v) { return v.quality === 2160 ? '4K' : v.quality + 'p'; }).join(' · '), function () {
                    choose('Качество · ' + r.voice, variants.map(function (v) { return {title:v.quality === 2160 ? '4K' : v.quality + 'p', stream:v}; }), function (v) { playFilmix(v.stream); });
                });
                $('<div class="kvn-voice-mark kvn-tag" style="align-self:flex-start;margin-top:.4em"></div>').data('voice',r.voice).appendTo(tile);
            });
            updateVoiceMarks();
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
        function renderTorrents(showAll) {
                    var result=displayTorrents(torrentRows || [],historyRead(historyKey),metadataIdentity,isSeries,season,episode), rows=result.rows; torBody.empty();
                    tor.find('h2').text(isSeries ? 'Торренты · сезон ' + season : 'Торренты');
                    if (!rows.length) message(torBody, 'Подходящих раздач не найдено.');
                    rows.slice(0, showAll ? rows.length : 40).forEach(function (r) {
                        var bytes = Number(r.Size) || 0, size = bytes ? (bytes / 1073741824).toFixed(1) + ' ГБ' : '';
                        var identity=metadataIdentity(r);
                        var match=isSeries ? torrentMatch(r.Title,season,episode) : 'match';
                        var tile=action(torBody, r.Title || 'Раздача', [size, match==='unknown' ? 'Сезон не указан' : '', r.Tracker || ''].filter(Boolean).join(' · '), function () {
                            var hash=torrentInfoHash(r),choice=hash ? 'btih:'+hash : identity;
                            var used=Object.assign({},historyRead(historyKey).torrentsUsed || {});used[choice]=true;
                            remember({source:'Торренты',torrent:choice,torrentsUsed:used});pendingTorrent={key:historyKey,identity:identity};
                            L.Torrent.back(function () {var recent=historyRead(historyKey);if(isSeries){season=recent.season || season;episode=recent.episode || episode;}drawControls();activate();}); L.Torrent.start(r, movie);
                        });
                        var badges=$('<div class="kvn-tags"></div>').insertAfter(tile.find('.kvn-row-title'));
                        rowBadges(r,movie).forEach(function (b) {$('<span class="kvn-tag"></span>').addClass('kvn-tag-'+b.kind).text(b.label).appendTo(badges);});
                        if(torrentIdentities(r,metadataIdentity).some(function(id){return usedTorrent(historyRead(historyKey),id);})) $('<span class="kvn-tag kvn-tag-history"></span>').text('Выбирали').appendTo(badges);
                        var seeds=$('<div class="kvn-seeds"></div>').attr('aria-label',seedLabel(r)).insertAfter(badges);
                        $('<span class="kvn-seeds-caption"></span>').text('Сиды').appendTo(seeds);
                        seedBadges(r).forEach(function(s,index) {
                            var badge=$('<span class="kvn-seed"></span>').addClass('kvn-seed-'+s.kind)
                                .toggleClass('kvn-seed-main',index===0 && s.count!==null).attr('title',s.title).appendTo(seeds);
                            if(s.count!==null) $('<b class="kvn-seed-number"></b>').text(s.count).appendTo(badge);
                            $('<span class="kvn-seed-source"></span>').text(s.label).appendTo(badge);
                        });
                    });
                    if(torrentSummary && (torrentSummary.pending || torrentSummary.failures)) message(torBody,'Показаны полученные результаты. Часть парсеров не ответила.');
                    if(!showAll && rows.length>40) action(torBody,'Показать остальные '+(rows.length-40),'',function(){renderTorrents(true);});
                    refreshFocus();
        }
        function loadTorrents() {
            if(torrentCollection) torrentCollection.cancel();
            var gen = ++torrentGeneration;
            torrentRows = null; torrentSummary=null; torBody.empty(); message(torBody, 'Собираем раздачи и уточняем данные трекеров… До 15 секунд.');
            action(torBody,'Показать сейчас','Открыть уже полученные результаты',function(){if(torrentCollection) torrentCollection.show();});
            refreshFocus();
            var suffix = isSeries ? ' S' + ('0' + season).slice(-2) : '';
            var m = Object.assign({genres: []}, movie);
            m.genres = m.genres || [];
            m.title = m.title || m.name; m.original_title = m.original_title || m.original_name || m.title;
            var params={movie:m,search:m.original_title+suffix,search_one:m.title+suffix,search_two:m.original_title+suffix,page:1};
            torrentCollection=createTorrentCollection({
                searches:parserSearches(L.Storage,L.Utils,function(){return new L.Reguest();},function(p,ok,fail){L.Parser.get(p,ok,fail);},params),
                probe:createTrackerProbe(L,root),includeUDP:true,
                candidates:function(rows){return displayTorrents(rows,historyRead(historyKey),metadataIdentity,isSeries,season,episode).rows;},
                setTimeout:function(fn,ms){return setTimeout(fn,ms);},clearTimeout:function(id){clearTimeout(id);},now:Date.now,
                ready:function(rows,summary){
                    if(dead || gen!==torrentGeneration) return;
                    torrentRows=rows; torrentSummary=summary; renderTorrents();
                    if(!rows.length) {action(torBody,'Повторить поиск','',loadTorrents); refreshFocus();}
                }
            });
            torrentCollection.start();
        }
        this.create = function () { return html; };
        this.render = function () { return html; };
        this.start = function () {
            if(ready && isSeries) {
                var recent=selectedEpisode(historyRead(historyKey));
                if(recent.season!==season || recent.episode!==episode) {
                    var changedSeason=recent.season!==season;
                    season=recent.season;episode=recent.episode;drawControls();drawStreams();
                    if(changedSeason) loadTorrents(); else if(torrentRows) renderTorrents();
                }
            }
            activate(); updateProgress(); updateVoiceMarks(); if (!ready) { ready = true; loadFilmix(); loadTorrents(); if (self.activity) self.activity.loader(false); }
        };
        this.pause = function () { active = false; };
        this.stop = function () { active = false; };
        this.destroy = function () { dead = true; active = false; if(torrentCollection) torrentCollection.cancel(); fx.destroy(); scroll.destroy(); html.remove(); };
    }
    function open(movie, context) { L.Activity.push({component: 'kvn_watch', title: 'Смотреть', movie: movie, season: context && context.season, episode: context && context.episode, page: 1}); }
    function attach(e) {
        if (e.type !== 'complite' || !e.data || !e.data.movie) return;
        var body = e.body || (e.object && e.object.activity && e.object.activity.render());
        if (body) $(body).each(function () { watchCards.set(this, e.data.movie); });
    }
    function watchMovie(target) {
        if (!target || target.nodeType !== 1 || !enabled()) return null;
        var button = target.closest('.button--play');
        if (!button) return null;
        for (var node = button; node; node = node.parentElement) {
            if (watchCards.has(node)) return watchCards.get(node);
        }
        return null;
    }
    function installWatchRouting() {
        // Lampa dispatches a non-bubbling native event. Capture survives its
        // button.unbind(), late source registration, and button replacement.
        document.addEventListener('hover:enter', function (event) {
            var movie = watchMovie(event.target);
            if (!movie) return;
            event.preventDefault(); event.stopImmediatePropagation();
            open(movie, event.detail);
        }, true);
        // Some extensions instead use jQuery.trigger(), which has no native
        // capture phase. Intercept only mapped Watch buttons; preserve others.
        var special = $.event.special['hover:enter'] || ($.event.special['hover:enter'] = {});
        var previous = special.trigger;
        special.trigger = function (event, context) {
            var movie = watchMovie(this);
            if (movie) { open(movie, context); return false; }
            if (previous) return previous.apply(this, arguments);
        };
    }
    function init() {
        L = root.Lampa; $ = root.jQuery || root.$;
        if (!L || !$ || !L.Component || !L.Parser) { setTimeout(init, 500); return; }
        if (root.KVNWatch.ready) return; root.KVNWatch.ready = true;
        if (!L.Storage.get('kvn_watch_backup_v1', false)) L.Storage.set('kvn_watch_backup_v1', {created: Date.now(), plugins: L.Storage.get('plugins', []), enabled: L.Storage.get('kvn_watch_enabled', null)});
        $('<style>').text('.kvn-watch{height:100%;padding:1.4em 2em;box-sizing:border-box}.kvn-title{font-size:1.8em;font-weight:600;margin-bottom:.6em}.kvn-controls{display:flex;gap:.65em;margin-bottom:1em}.kvn-row{padding:.85em 1em;border-radius:.65em;background:rgba(255,255,255,.08);margin:.4em 0}.kvn-row.focus{background:#fff;color:#141820}.kvn-row-title{font-size:1.05em}.kvn-detail{opacity:.65;font-size:.8em;margin-top:.3em}.kvn-controls .kvn-row{font-size:.85em}.kvn-section{margin-bottom:1.6em}.kvn-section h2{font-size:1.3em;margin:0 0 .5em}.kvn-message{opacity:.72;padding:.6em 0 1em}.kvn-auth{line-height:1.5}').appendTo('head');
        $('<style>').text('.kvn-section h2{height:1.6em;line-height:1.6em;margin:0 0 .5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.kvn-section .kvn-row{height:6.5em;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center}.kvn-section .kvn-row-title{line-height:1.15;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.kvn-section .kvn-detail{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}.kvn-account-badge{display:inline-block;margin-left:.65em;padding:.15em .45em;border-radius:.4em;background:#20262c;font-size:.85em}').appendTo('head');
        $('<style>').text('.kvn-progress{font-size:.85em;color:#9dccff;min-height:1.5em;margin-bottom:.5em}.kvn-progress.kvn-done{color:#58df90}.kvn-section .kvn-row{height:8em}.kvn-tags{display:flex;gap:.3em;flex-wrap:wrap;margin:.35em 0 .1em;flex-shrink:0}.kvn-tag{font-size:.68em;line-height:1.35;padding:.14em .4em;border-radius:.3em;background:#343b49;color:#d6dbe5}.kvn-tag-quality{background:#253e66;color:#a5d0ff}.kvn-tag-hdr{background:#514226;color:#ffe090}.kvn-tag-codec{background:#40315f;color:#d6bcff}.kvn-tag-rate{background:#214a45;color:#9aead8}.kvn-tag-history{background:#245536;color:#a2edb7}').appendTo('head');
        $('<style>').text('.kvn-torrents .kvn-row{height:auto;min-height:8em}.kvn-torrents .kvn-detail{white-space:normal;overflow:visible;overflow-wrap:anywhere}').appendTo('head');
        $('<style>').text('.kvn-seeds{display:flex;align-items:center;gap:.38em;flex-wrap:wrap;margin:.4em 0 .1em;flex-shrink:0}.kvn-seeds-caption{font-size:.72em;opacity:.7;margin-right:.1em}.kvn-seed{display:inline-flex;align-items:center;gap:.4em;line-height:1.2;padding:.18em .5em;border:1px solid transparent;border-radius:.4em;white-space:nowrap}.kvn-seed-number{font-size:1.05em;font-weight:700;font-variant-numeric:tabular-nums}.kvn-seed-source{font-size:.7em}.kvn-seed-main .kvn-seed-number{font-size:1.2em}.kvn-seed-live{background:#203f32;color:#a4edbb;border-color:#355b43}.kvn-seed-site{background:#293b53;color:#b4d6ff;border-color:#3b536f}.kvn-seed-neutral{background:#353b44;color:#bbc2cc}.kvn-row.focus .kvn-seed-live{background:#dcefe3;color:#205b34;border-color:#bddcc8}.kvn-row.focus .kvn-seed-site{background:#e0eafb;color:#284f81;border-color:#c3d6ee}.kvn-row.focus .kvn-seed-neutral{background:#e9edf2;color:#555e6b}').appendTo('head');
        L.Component.add('kvn_watch', Screen); installWatchRouting(); installHistory(); L.Listener.follow('full', attach);
        if (L.SettingsApi) {
            L.SettingsApi.addComponent({component: 'kvn_watch_settings', name: 'Простой просмотр', icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 3v18l14-9z"/></svg>'});
            L.SettingsApi.addParam({component: 'kvn_watch_settings', param: {name: 'kvn_watch_enabled', type: 'trigger', default: true}, field: {name: 'Filmix и торренты по кнопке «Смотреть»', description: 'Выключите, чтобы вернуть прежнее меню источников.'}});
        }
        report('ready', {parser: !!L.Parser, torrent: !!L.Torrent, tokenPresent: !!token()});
    }
    root.KVNWatch = {version: VERSION, ready: false, open: function (movie) { open(movie); }};
    init();
})(typeof window === 'object' ? window : globalThis);
