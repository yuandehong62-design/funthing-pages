self.addEventListener('install',function(e){self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});
self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).catch(function(){
      return new Response('<!DOCTYPE html><meta charset="utf-8"><title>离线</title><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:40vh;color:#61666d">当前无网络，请连网后重试</body>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
    }));
  }
});
