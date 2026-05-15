const CACHE_NAME = 'mi-tienda-v1';
const urlsToCache = [
  './',
  './index.html',
  './app-final.js',
  './styles.css',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css'
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache abierto');
        return cache.addAll(urlsToCache).catch(() => {
          console.log('Algunos recursos no se pudieron cachear');
        });
      })
  );
  self.skipWaiting();
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia de caché: primero red, si falla caché
self.addEventListener('fetch', (event) => {
  // No cachear requests a APIs externas
  if (event.request.url.includes('cdn.tailwindcss.com') ||
      event.request.url.includes('cdnjs.cloudflare.com') ||
      event.request.url.includes('cdn.jsdelivr.net')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Si la respuesta es ok, guardarla en caché
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Si no hay conexión, usar caché
        return caches.match(event.request)
          .then((response) => {
            return response || new Response(
              'No hay conexión a internet',
              { status: 503, statusText: 'Service Unavailable' }
            );
          });
      })
  );
});