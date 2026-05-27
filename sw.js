/* Glucose Tablet Timer service worker.
   Strategy:
     - The PAGE (index.html / navigations) is NETWORK-FIRST: when online it always
       fetches your latest upload and refreshes the cache, so you never bump a version.
       When offline (or the network is slow) it instantly serves the last cached copy.
     - Static assets (vendored libraries, fonts, icons) are CACHE-FIRST: instant + offline.
     - API calls (anthropic.com) are never touched. */
var CACHE = 'glucose-timer';
var DOC_TIMEOUT = 2500; /* ms before falling back to cached page on a slow network */
var ASSETS = [
  './', './index.html', './fonts.css', './manifest.webmanifest',
  './vendor/chart.umd.js', './vendor/xlsx.full.min.js',
  './fonts/ibm-plex-sans-latin-400-normal.woff2',
  './fonts/ibm-plex-sans-latin-500-normal.woff2',
  './fonts/ibm-plex-sans-latin-600-normal.woff2',
  './fonts/ibm-plex-mono-latin-400-normal.woff2',
  './fonts/ibm-plex-mono-latin-500-normal.woff2',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ASSETS); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ if(k!==CACHE) return caches.delete(k); })); }).then(function(){ return self.clients.claim(); }));
});

function updateCache(req, res){ if(res && res.status===200){ var copy=res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); } }

/* network-first with timeout + cache fallback; always refreshes cache on a good fetch */
function networkFirst(req){
  return new Promise(function(resolve){
    var settled=false;
    var timer=setTimeout(function(){ caches.match(req).then(function(hit){ if(hit && !settled){ settled=true; resolve(hit); } }); }, DOC_TIMEOUT);
    /* bypass the browser HTTP cache for the page so we see fresh uploads */
    fetch(new Request(req.url, {cache:'no-store'})).then(function(res){
      updateCache(req, res);            /* refresh cache even if we already served stale */
      if(!settled){ settled=true; clearTimeout(timer); resolve(res); }
    }).catch(function(){
      clearTimeout(timer);
      if(!settled){ settled=true; caches.match(req).then(function(hit){ resolve(hit || caches.match('./index.html')); }); }
    });
  });
}

self.addEventListener('fetch', function(e){
  var req=e.request; if(req.method!=='GET') return;
  var url=new URL(req.url);
  if(url.hostname.indexOf('anthropic.com')!==-1) return; /* never intercept API calls */
  var isDoc = req.mode==='navigate' || (url.origin===location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')));
  if(isDoc){ e.respondWith(networkFirst(req)); return; }
  /* static assets: cache-first */
  e.respondWith(
    caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){ if(url.origin===location.origin) updateCache(req,res); return res; }).catch(function(){ return hit; });
    })
  );
});
