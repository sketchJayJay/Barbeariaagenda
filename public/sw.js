// A agenda sempre usa dados atuais do servidor; não serve horários em cache.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
