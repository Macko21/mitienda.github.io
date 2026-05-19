// ===============================
// BASE DE DATOS
// ===============================

let db = {
  clientes: JSON.parse(localStorage.getItem('clientes')) || [],
  productos: JSON.parse(localStorage.getItem('productos')) || [],
  ventas: JSON.parse(localStorage.getItem('ventas')) || [],
  pagos: JSON.parse(localStorage.getItem('pagos')) || [],
  ventaCounter: parseInt(localStorage.getItem('ventaCounter')) || 0
};

let carrito = [];

// ===============================
// CACHE DE IMAGENES CON INDEXEDDB
// ===============================

let dbImagenes;

function inicializarCacheImagenes() {
  const request = indexedDB.open('TiendaImagenes', 1);

  request.onerror = () => console.log('Error al abrir IndexedDB');
  request.onsuccess = (e) => {
    dbImagenes = e.target.result;
  };

  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('imagenes')) {
      db.createObjectStore('imagenes', { keyPath: 'id' });
    }
  };
}

function obtenerImagenCacheada(productoId) {
  return new Promise((resolve) => {
    if (!dbImagenes) {
      resolve(null);
      return;
    }

    const transaction = dbImagenes.transaction('imagenes', 'readonly');
    const store = transaction.objectStore('imagenes');
    const request = store.get(productoId);

    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => resolve(null);
  });
}

function guardarImagenEnCache(productoId, base64) {
  if (!dbImagenes) return;

  const transaction = dbImagenes.transaction('imagenes', 'readwrite');
  const store = transaction.objectStore('imagenes');
  store.put({ id: productoId, data: base64 });
}

inicializarCacheImagenes();

// ===============================
// GUARDAR DB
// ===============================

function saveDB() {
  const ahora = new Date().getTime();

  try {
    const datosParaGuardar = {
      clientes: db.clientes,
      productos: db.productos.map(p => ({ ...p, foto: null })),
      ventas: db.ventas,
      pagos: db.pagos,
      ventaCounter: db.ventaCounter
    };

    localStorage.setItem('clientes', JSON.stringify(datosParaGuardar.clientes));
    localStorage.setItem('productos', JSON.stringify(datosParaGuardar.productos));
    localStorage.setItem('ventas', JSON.stringify(datosParaGuardar.ventas));
    localStorage.setItem('pagos', JSON.stringify(datosParaGuardar.pagos));
    localStorage.setItem('ventaCounter', datosParaGuardar.ventaCounter.toString());
    localStorage.setItem('ultimaActualizacion', ahora.toString());
    console.log('✓ Guardado en localStorage (sin imágenes)');

    db.productos.forEach(p => {
      if (p.foto && p.foto.startsWith('data:image')) {
        guardarImagenEnCache(p.id, p.foto);
      }
    });

  } catch (error) {
    console.error('Error al guardar en localStorage:', error);
    if (error.name === 'QuotaExceededError') {
      console.warn('localStorage lleno. Limpiando imágenes...');
      localStorage.clear();
      setTimeout(() => saveDB(), 500);
      return;
    }
  }

  if (window.firebaseDB) {
    setTimeout(() => {
      window.firebaseDB.ref('tienda').set({
        clientes: db.clientes,
        productos: db.productos,
        ventas: db.ventas,
        pagos: db.pagos,
        ventaCounter: db.ventaCounter,
        ultimaActualizacion: new Date().toISOString()
      }).then(() => {
        console.log('✓ Sincronizado con Firebase');
      }).catch(error => {
        console.error('Error guardando en Firebase:', error);
      });
    }, 0);
  }
}

let sincronizandoFirebase = false;

async function cargarImagenesDelCache() {
  if (!dbImagenes) return;

  for (let producto of db.productos) {
    const imagen = await obtenerImagenCacheada(producto.id);
    if (imagen) {
      producto.foto = imagen;
    }
  }
  console.log('✓ Imágenes cargadas desde IndexedDB');
}

function cargarDatosFirebase() {
  return new Promise(async (resolve) => {
    if (!window.firebaseDB) {
      console.log('✓ Usando localStorage (Firebase no configurado)');
      await cargarImagenesDelCache();
      resolve();
      return;
    }

    sincronizandoFirebase = true;
    console.log('Cargando datos desde Firebase...');

    window.firebaseDB.ref('tienda').once('value', async (snapshot) => {
      const datos = snapshot.val();

      if (datos && datos.ultimaActualizacion) {
        console.log('✓ Datos cargados desde Firebase');
        db.clientes = datos.clientes || [];
        db.productos = datos.productos || [];
        db.ventas = datos.ventas || [];
        db.pagos = datos.pagos || [];
        db.ventaCounter = datos.ventaCounter || 0;

        const productosParaGuardar = db.productos.map(p => ({ ...p, foto: null }));
        localStorage.setItem('clientes', JSON.stringify(db.clientes));
        localStorage.setItem('productos', JSON.stringify(productosParaGuardar));
        localStorage.setItem('ventas', JSON.stringify(db.ventas));
        localStorage.setItem('pagos', JSON.stringify(db.pagos));
        localStorage.setItem('ventaCounter', db.ventaCounter.toString());

        db.productos.forEach(p => {
          if (p.foto && p.foto.startsWith('data:image')) {
            guardarImagenEnCache(p.id, p.foto);
          }
        });

        await cargarImagenesDelCache();
      } else {
        console.log('No hay datos en Firebase');
        await cargarImagenesDelCache();
      }

      window.firebaseDB.ref('tienda').on('value', async (snapshot) => {
        const datosActualizados = snapshot.val();

        if (datosActualizados && datosActualizados.ultimaActualizacion) {
          const tiempoLocal = localStorage.getItem('ultimaActualizacion') || '0';
          const tiempoFirebase = new Date(datosActualizados.ultimaActualizacion).getTime();

          if (tiempoFirebase > parseInt(tiempoLocal)) {
            console.log('Sincronizando cambios desde Firebase');
            db.clientes = datosActualizados.clientes || [];
            db.productos = datosActualizados.productos || [];
            db.ventas = datosActualizados.ventas || [];
            db.pagos = datosActualizados.pagos || [];
            db.ventaCounter = datosActualizados.ventaCounter || 0;

            localStorage.setItem('ultimaActualizacion', tiempoFirebase.toString());

            db.productos.forEach(p => {
              if (p.foto && p.foto.startsWith('data:image')) {
                guardarImagenEnCache(p.id, p.foto);
              }
            });

            await cargarImagenesDelCache();

            if (document.getElementById('content')) {
              const currentTab = parseInt(document.querySelector('.tab-active')?.id?.replace('tab', '') || '0');
              showTab(currentTab);
            }
          }
        }
      });

      sincronizandoFirebase = false;
      resolve();
    }).catch((error) => {
      console.error('Error cargando datos de Firebase:', error);
      console.log('Usando datos locales como fallback');
      sincronizandoFirebase = false;
      resolve();
    });
  });
}

// ===============================
// MENU MOBILE
// ===============================

function toggleMenu() {
  document.getElementById('sidebar').classList.toggle('sidebar-hidden');
  document.getElementById('overlay').classList.toggle('hidden');
}

// ===============================
// TABS
// ===============================

function showTab(n) {

  currentTab = n;

  for (let i = 0; i <= 6; i++) {
    const btn = document.getElementById('tab' + i);
    if (btn) {
      btn.classList.remove('tab-active');
    }
  }

  const activeBtn = document.getElementById('tab' + n);
  if (activeBtn) {
    activeBtn.classList.add('tab-active');
  }

  const content = document.getElementById('content');

  switch (n) {
    case 0:
      content.innerHTML = dashboardHTML();
      break;
    case 1:
      content.innerHTML = clientesHTML();
      break;
    case 2:
      content.innerHTML = articulosHTML();
      break;
    case 3:
      content.innerHTML = catalogoHTML();
      break;
    case 4:
      content.innerHTML = nuevaVentaHTML();
      setTimeout(() => {
        actualizarCarrito();
      }, 50);
      break;
    case 5:
      content.innerHTML = pagosHTML();
      break;
    case 6:
      content.innerHTML = historialVentasHTML();
      break;
  }

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.add('sidebar-hidden');
  }

  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

// ===============================
// DASHBOARD
// ===============================

function dashboardHTML() {
  const total = db.ventas.reduce((a, v) => a + (v.total || 0), 0);
  const pendientes = db.ventas.filter(v => v.saldo > 0).length;

  return `
    <div class="mb-8">
      <h1 class="text-3xl md:text-4xl font-black text-gray-800">Dashboard</h1>
      <p class="text-gray-500 mt-2">Resumen general del negocio</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
      <div class="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-6 rounded-3xl shadow-xl">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-blue-100">Total Vendido</p>
            <h2 class="text-4xl font-black mt-2">$${total.toLocaleString()}</h2>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">💰</div>
        </div>
      </div>

      <div class="bg-white p-6 rounded-3xl shadow-xl border border-gray-100">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500">Clientes</p>
            <h2 class="text-4xl font-black mt-2 text-gray-800">${db.clientes.length}</h2>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl">👥</div>
        </div>
      </div>

      <div class="bg-white p-6 rounded-3xl shadow-xl border border-gray-100">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-gray-500">Artículos</p>
            <h2 class="text-4xl font-black mt-2 text-gray-800">${db.productos.length}</h2>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center text-3xl">📦</div>
        </div>
      </div>

      <div class="bg-gradient-to-r from-orange-500 to-red-500 text-white p-6 rounded-3xl shadow-xl">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-orange-100">Pagos Pendientes</p>
            <h2 class="text-4xl font-black mt-2">${pendientes}</h2>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">🧾</div>
        </div>
      </div>
    </div>
  `;
}

// ===============================
// CLIENTES
// ===============================

function clientesHTML() {
  return `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-3xl font-black text-gray-800">Clientes</h1>
        <p class="text-gray-500">Administración de clientes</p>
      </div>
      <button onclick="abrirFormularioCliente()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-2xl font-bold shadow-lg">
        + Nuevo Cliente
      </button>
    </div>

    <div class="space-y-4">
      ${db.clientes.map(c => `
        <div class="bg-white rounded-3xl p-5 shadow border border-gray-100">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="font-black text-lg text-gray-800">${c.nombre}</h3>
              <p class="text-gray-500 mt-1">📞 ${c.telefono || '-'}</p>
              <p class="text-green-600 font-bold mt-2">Compró: $${(c.compras || 0).toLocaleString()}</p>
            </div>
            <div class="flex gap-2">
              <button onclick="editarCliente(${c.id})" class="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700">✏️</button>
              <button onclick="eliminarCliente(${c.id})" class="w-12 h-12 rounded-2xl bg-red-100 text-red-700">🗑️</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ===============================
// FORM CLIENTE
// ===============================

function abrirFormularioCliente(cliente = null) {
  document.getElementById('modalContent').innerHTML = `
    <div class="p-6">
      <h2 class="text-3xl font-black mb-6">${cliente ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>

      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Nombre</label>
        <input id="nombre" type="text" autocomplete="off" placeholder="Ej: Juan García" value="${cliente?.nombre || ''}" class="w-full p-4 border-2 border-gray-300 rounded-xl text-lg focus:outline-none focus:border-blue-500">
      </div>

      <div class="mb-6">
        <label class="block text-sm font-bold text-gray-700 mb-2">Teléfono</label>
        <input id="telefono" type="tel" autocomplete="off" placeholder="Ej: +54 9 11 1234567" value="${cliente?.telefono || ''}" class="w-full p-4 border-2 border-gray-300 rounded-xl text-lg focus:outline-none focus:border-blue-500">
      </div>

      <div class="grid grid-cols-2 gap-4">
        <button onclick="guardarCliente(${cliente ? cliente.id : 'null'})" class="bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700">Guardar</button>
        <button onclick="cerrarModalImproved()" class="bg-gray-200 py-4 rounded-2xl font-bold text-lg hover:bg-gray-300">Cancelar</button>
      </div>
    </div>
  `;
  abrirModal();
}

function guardarCliente(id) {
  const nombre = document.getElementById('nombre').value.trim();
  const telefono = document.getElementById('telefono').value.trim();

  if(!nombre) {
    return Swal.fire({ icon:'warning', title:'Ingrese nombre' });
  }

  if(id !== null) {
    const cliente = db.clientes.find(c => c.id == id);
    if (cliente) {
      cliente.nombre = nombre;
      cliente.telefono = telefono;
    }
  } else {
    db.clientes.push({ id: Date.now(), nombre, telefono, compras: 0 });
  }

  saveDB();
  cerrarModalImproved();

  Swal.fire({
    icon: 'success',
    title: 'Cliente guardado',
    text: nombre,
    toast: true,
    position: 'top-end',
    timer: 2000,
    showConfirmButton: false
  });

  showTab(1);
}

function editarCliente(id) {
  const cliente = db.clientes.find(c => c.id == id);
  abrirFormularioCliente(cliente);
}

function eliminarCliente(id) {
  Swal.fire({
    title:'¿Eliminar cliente?',
    icon:'warning',
    showCancelButton:true
  }).then(r => {
    if(r.isConfirmed) {
      db.clientes = db.clientes.filter(c => c.id != id);
      saveDB();
      showTab(1);
    }
  });
}

// ===============================
// ARTICULOS
// ===============================

function articulosHTML() {
  return `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-3xl font-black text-gray-800">Artículos</h1>
        <p class="text-gray-500">Gestión de stock y precios</p>
      </div>
      <button onclick="abrirFormularioProducto()" class="bg-green-600 text-white px-6 py-4 rounded-2xl font-bold shadow-lg">
        + Nuevo Artículo
      </button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      ${db.productos.map(p => `
        <div class="bg-white rounded-3xl overflow-hidden shadow-xl border border-gray-100">
          <div class="w-full h-52 bg-gray-300 relative overflow-hidden">
            <img src="${p.foto || 'https://picsum.photos/500/300'}" loading="lazy" class="w-full h-52 object-cover" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22500%22 height=%22300%22%3E%3Crect fill=%22%23ccc%22 width=%22500%22 height=%22300%22/%3E%3C/svg%3E'">
          </div>

          <div class="p-5">
            <div class="flex justify-between items-start gap-3">
              <div>
                <h3 class="font-black text-xl text-gray-800">${p.nombre}</h3>
                <p class="text-gray-500 mt-1">Stock: ${p.stock}</p>
              </div>
              <div class="flex gap-2">
                <button onclick="editarProducto(${p.id})" class="w-10 h-10 rounded-xl bg-blue-100">✏️</button>
                <button onclick="eliminarProducto(${p.id})" class="w-10 h-10 rounded-xl bg-red-100">🗑️</button>
              </div>
            </div>

            <div class="mt-5">
              <p class="text-sm text-gray-500">Precio contado</p>
              <h2 class="text-4xl font-black text-green-600">$${p.precioContado}</h2>
            </div>

            <div class="grid grid-cols-2 gap-3 mt-5 text-sm">
              <div class="bg-gray-100 p-3 rounded-2xl">
                4 cuotas<br>
                <span class="font-black">$${p.preciosCuotas?.[4] || 0}</span>
              </div>
              <div class="bg-gray-100 p-3 rounded-2xl">
                6 cuotas<br>
                <span class="font-black">$${p.preciosCuotas?.[6] || 0}</span>
              </div>
              <div class="bg-gray-100 p-3 rounded-2xl">
                8 cuotas<br>
                <span class="font-black">$${p.preciosCuotas?.[8] || 0}</span>
              </div>
              <div class="bg-gray-100 p-3 rounded-2xl">
                Quincena<br>
                <span class="font-black">$${p.preciosCuotas?.quincena || 0}</span>
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ===============================
// MODAL PRODUCTO - FORMULARIO MEJORADO
// ===============================

function abrirFormularioProducto(prod = null) {
  document.getElementById('modalContent').innerHTML = `
    <div class="p-8 max-h-[90vh] overflow-y-auto bg-gradient-to-br from-white via-blue-50 to-white">

      <!-- Header -->
      <div class="mb-8 pb-6 border-b-2 border-blue-100">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-4xl">${prod ? '✏️' : '📦'}</span>
          <h2 class="text-3xl font-black bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">
            ${prod ? 'Editar Artículo' : 'Nuevo Artículo'}
          </h2>
        </div>
        <p class="text-gray-500 ml-1">${prod ? 'Actualiza los detalles del producto' : 'Crea un nuevo producto para tu tienda'}</p>
      </div>

      <!-- Grid de 2 columnas -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">

        <!-- COLUMNA IZQUIERDA: Información básica -->
        <div>
          <!-- Nombre -->
          <div class="mb-6">
            <label class="block text-sm font-bold text-gray-700 mb-3">📝 Nombre del Artículo</label>
            <input id="nombreProd" type="text" autocomplete="off" placeholder="Ej: iPhone 15 Pro" value="${prod?.nombre || ''}" class="w-full p-4 border-2 border-gray-200 rounded-2xl text-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all">
          </div>

          <!-- Imagen -->
          <div class="mb-6">
            <label class="block text-sm font-bold text-gray-700 mb-3">🖼️ Imagen del Producto</label>
            <div class="relative">
              <input id="fotoInput" type="file" accept="image/*" onchange="mostrarPreviewImagen()" class="w-full p-4 border-2 border-dashed border-blue-300 rounded-2xl text-lg cursor-pointer hover:border-blue-500 transition-colors file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200">
              ${prod?.foto ? `<p class="text-xs text-green-600 font-semibold mt-2">✓ Imagen actual guardada</p>` : ''}
            </div>
            <!-- Vista previa de imagen -->
            <div id="previewImagen" class="mt-4 rounded-2xl overflow-hidden border-2 border-blue-200 bg-gray-100 ${prod?.foto ? '' : 'hidden'}">
              <img id="imgPreview" src="${prod?.foto || ''}" alt="Preview" class="w-full h-48 object-cover">
            </div>
          </div>

          <!-- Stock -->
          <div class="mb-6">
            <label class="block text-sm font-bold text-gray-700 mb-3">📦 Stock Disponible</label>
            <div class="relative">
              <input id="stock" type="number" autocomplete="off" placeholder="0" value="${prod?.stock || 0}" class="w-full p-4 border-2 border-gray-200 rounded-2xl text-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all">
              <span class="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 font-bold">unidades</span>
            </div>
          </div>
        </div>

        <!-- COLUMNA DERECHA: Precios -->
        <div>
          <!-- Costos -->
          <div class="mb-6 p-5 bg-gradient-to-br from-red-50 to-orange-50 rounded-2xl border-2 border-red-200">
            <h3 class="text-sm font-black text-red-700 mb-4 flex items-center gap-2">💰 Costos</h3>
            <div class="space-y-3">
              <div>
                <label class="text-xs font-bold text-gray-600 block mb-2">Costo de Compra</label>
                <input id="costo" type="number" autocomplete="off" placeholder="$0" value="${prod?.costo || ''}" class="w-full p-3 border-2 border-red-200 rounded-xl text-base focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100">
              </div>
              <div>
                <label class="text-xs font-bold text-gray-600 block mb-2">Precio de Venta (Contado)</label>
                <input id="precioContado" type="number" autocomplete="off" placeholder="$0" value="${prod?.precioContado || ''}" class="w-full p-3 border-2 border-green-200 rounded-xl text-base focus:outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100">
              </div>
            </div>
          </div>

          <!-- Precios por cuota -->
          <div class="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border-2 border-blue-200">
            <h3 class="text-sm font-black text-blue-700 mb-4 flex items-center gap-2">💳 Opciones de Pago</h3>
            <div class="space-y-3">
              <div class="bg-white p-3 rounded-xl border border-blue-200 hover:border-blue-400 transition-colors">
                <div class="flex justify-between items-center mb-2">
                  <label class="text-xs font-bold text-gray-700">4 Cuotas</label>
                  <span class="text-xs font-bold text-blue-600">4x</span>
                </div>
                <input id="c4" type="number" autocomplete="off" placeholder="$0" value="${prod?.preciosCuotas?.[4] || ''}" oninput="mostrarTotalCuota(4)" class="w-full p-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 font-bold">
                <p id="info4" class="text-xs text-blue-600 font-bold mt-2">Total: $${((prod?.preciosCuotas?.[4] || 0) * 4).toLocaleString()}</p>
              </div>

              <div class="bg-white p-3 rounded-xl border border-blue-200 hover:border-blue-400 transition-colors">
                <div class="flex justify-between items-center mb-2">
                  <label class="text-xs font-bold text-gray-700">6 Cuotas</label>
                  <span class="text-xs font-bold text-blue-600">6x</span>
                </div>
                <input id="c6" type="number" autocomplete="off" placeholder="$0" value="${prod?.preciosCuotas?.[6] || ''}" oninput="mostrarTotalCuota(6)" class="w-full p-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 font-bold">
                <p id="info6" class="text-xs text-blue-600 font-bold mt-2">Total: $${((prod?.preciosCuotas?.[6] || 0) * 6).toLocaleString()}</p>
              </div>

              <div class="bg-white p-3 rounded-xl border border-blue-200 hover:border-blue-400 transition-colors">
                <div class="flex justify-between items-center mb-2">
                  <label class="text-xs font-bold text-gray-700">8 Cuotas</label>
                  <span class="text-xs font-bold text-blue-600">8x</span>
                </div>
                <input id="c8" type="number" autocomplete="off" placeholder="$0" value="${prod?.preciosCuotas?.[8] || ''}" oninput="mostrarTotalCuota(8)" class="w-full p-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 font-bold">
                <p id="info8" class="text-xs text-blue-600 font-bold mt-2">Total: $${((prod?.preciosCuotas?.[8] || 0) * 8).toLocaleString()}</p>
              </div>

              <div class="bg-white p-3 rounded-xl border border-blue-200 hover:border-blue-400 transition-colors">
                <div class="flex justify-between items-center mb-2">
                  <label class="text-xs font-bold text-gray-700">Quincena (c/15 días)</label>
                  <span class="text-xs font-bold text-blue-600">Q</span>
                </div>
                <input id="cquincena" type="number" autocomplete="off" placeholder="$0" value="${prod?.preciosCuotas?.quincena || ''}" oninput="mostrarTotalQuincena()" class="w-full p-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 font-bold">
                <p id="infoquincena" class="text-xs text-blue-600 font-bold mt-2">Total (2 quincenas): $${((prod?.preciosCuotas?.quincena || 0) * 2).toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Botones de acción -->
      <div class="grid grid-cols-2 gap-4 mt-10 pt-8 border-t-2 border-blue-100">
        <button onclick="guardarProducto(${prod ? prod.id : 'null'})" class="bg-gradient-to-r from-green-500 to-green-600 text-white py-4 px-6 rounded-2xl font-bold text-lg hover:from-green-600 hover:to-green-700 shadow-lg hover:shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2">
          <span>💾</span>
          <span>Guardar Artículo</span>
        </button>

        <button onclick="cerrarModalImproved()" class="bg-gradient-to-r from-gray-300 to-gray-400 text-gray-800 py-4 px-6 rounded-2xl font-bold text-lg hover:from-gray-400 hover:to-gray-500 shadow-lg hover:shadow-xl transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2">
          <span>✕</span>
          <span>Cancelar</span>
        </button>
      </div>

    </div>
  `;

  abrirModal();
}

function mostrarPreviewImagen() {
  const file = document.getElementById('fotoInput').files[0];
  const previewDiv = document.getElementById('previewImagen');
  const imgPreview = document.getElementById('imgPreview');

  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      imgPreview.src = e.target.result;
      previewDiv.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
}

function mostrarTotalCuota(c) {
  const valor = Number(document.getElementById(`c${c}`).value) || 0;
  document.getElementById(`info${c}`).innerHTML = `Total: $${(valor * c).toLocaleString()}`;
}

function guardarProducto(id) {
  const nombre = document.getElementById('nombreProd').value.trim();

  if(!nombre) {
    return Swal.fire({ icon:'warning', title:'Ingrese nombre' });
  }

  const file = document.getElementById('fotoInput').files[0];

  if(file) {
    const reader = new FileReader();
    reader.onload = e => {
      saveProductoFinal(id, nombre, e.target.result);
    };
    reader.readAsDataURL(file);
  } else {
    saveProductoFinal(id, nombre, null);
  }
}

function saveProductoFinal(id, nombre, foto) {
  const productoExistente = id !== null ? db.productos.find(p => p.id == id) : null;

  const producto = {
    id: id !== null ? id : Date.now(),
    nombre,
    costo: Number(document.getElementById('costo').value) || 0,
    precioContado: Number(document.getElementById('precioContado').value) || 0,
    stock: Number(document.getElementById('stock').value) || 0,

    preciosCuotas: {
      4: Number(document.getElementById('c4').value) || 0,
      6: Number(document.getElementById('c6').value) || 0,
      8: Number(document.getElementById('c8').value) || 0,
      quincena: Number(document.getElementById('cquincena').value) || 0
    },

    foto: foto || productoExistente?.foto || null
  };

  if (producto.foto && producto.foto.startsWith('data:image')) {
    guardarImagenEnCache(producto.id, producto.foto);
  }

  if(id !== null) {
    const index = db.productos.findIndex(p => p.id == id);
    if (index !== -1) {
      db.productos[index] = producto;
    }
  } else {
    db.productos.push(producto);
  }

  saveDB();
  cerrarModalImproved();

  Swal.fire({
    icon: 'success',
    title: 'Artículo guardado',
    text: nombre,
    toast: true,
    position: 'top-end',
    timer: 2000,
    showConfirmButton: false
  });

  showTab(2);
}

function editarProducto(id) {
  const prod = db.productos.find(p => p.id == id);
  abrirFormularioProducto(prod);
}

function eliminarProducto(id) {
  Swal.fire({
    title:'¿Eliminar artículo?',
    icon:'warning',
    showCancelButton:true
  }).then(r => {
    if(r.isConfirmed) {
      db.productos = db.productos.filter(p => p.id != id);
      saveDB();
      showTab(2);
    }
  });
}

// ===============================
// CATALOGO
// ===============================

function catalogoHTML() {
  return `
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-black">Catálogo</h1>
        <p class="text-gray-500">Vista para clientes</p>
      </div>

      <div class="flex gap-3">
        <button onclick="exportarCatalogoPDF()" class="bg-red-600 text-white px-5 py-3 rounded-2xl font-bold hover:bg-red-700">📄 PDF</button>
        <button onclick="compartirPorWhatsApp()" class="bg-green-600 text-white px-5 py-3 rounded-2xl font-bold hover:bg-green-700">💬 WhatsApp</button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
      ${db.productos.map(p => `
        <div class="bg-white rounded-3xl overflow-hidden shadow-xl">
          <div class="w-full h-64 bg-gray-300 relative overflow-hidden">
            <img src="${p.foto || 'https://picsum.photos/500/300'}" loading="lazy" class="w-full h-64 object-cover" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22500%22 height=%22400%22%3E%3Crect fill=%22%23ccc%22 width=%22500%22 height=%22400%22/%3E%3C/svg%3E'">
          </div>

          <div class="p-5">
            <h2 class="text-2xl font-black">${p.nombre}</h2>

            <p class="text-4xl font-black text-green-600 mt-4">$${p.precioContado}</p>
            <p class="text-gray-500">Contado</p>

            <div class="grid grid-cols-2 gap-3 mt-5">
              <div class="bg-gray-100 rounded-2xl p-3">
                <p class="text-xs text-gray-500">4 cuotas</p>
                <p class="font-black text-lg">$${p.preciosCuotas?.[4] || 0}</p>
              </div>

              <div class="bg-gray-100 rounded-2xl p-3">
                <p class="text-xs text-gray-500">6 cuotas</p>
                <p class="font-black text-lg">$${p.preciosCuotas?.[6] || 0}</p>
              </div>

              <div class="bg-gray-100 rounded-2xl p-3">
                <p class="text-xs text-gray-500">8 cuotas</p>
                <p class="font-black text-lg">$${p.preciosCuotas?.[8] || 0}</p>
              </div>

              <div class="bg-gray-100 rounded-2xl p-3">
                <p class="text-xs text-gray-500">Quincena</p>
                <p class="font-black text-lg">$${p.preciosCuotas?.quincena || 0}</p>
              </div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ===============================
// EXPORTAR PDF
// ===============================

async function exportarCatalogoPDF() {
  if (!db.productos || db.productos.length === 0) {
    return Swal.fire({ icon: 'warning', title: 'No hay productos', text: 'Agrega artículos primero' });
  }

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

  script.onload = function() {
    let html = `
      <div style="font-family: Arial, sans-serif; padding: 15px;">
        <h1 style="text-align: center; color: #1f2937; margin-bottom: 5px; font-size: 24px;">CATALOGO DE PRODUCTOS</h1>
        <p style="text-align: center; color: #6b7280; margin-bottom: 20px; font-size: 11px;">
          ${new Date().toLocaleDateString('es-AR')}
        </p>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
    `;

    db.productos.forEach((p, index) => {
      html += `
        <div style="border: 1px solid #d1d5db; border-radius: 6px; padding: 10px; page-break-inside: avoid;">
          <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <img src="${p.foto || 'https://picsum.photos/300/300'}" style="width: 110px; height: 110px; object-fit: cover; border-radius: 4px; flex-shrink: 0;">

            <div style="flex: 1; display: flex; flex-direction: column;">
              <h3 style="margin: 0 0 5px 0; color: #1f2937; font-size: 13px; font-weight: bold;">
                ${p.nombre}
              </h3>

              <div style="background: #fef3c7; padding: 6px; border-radius: 3px; margin-bottom: 6px;">
                <p style="margin: 0; color: #16a34a; font-size: 14px; font-weight: bold;">
                  $${p.precioContado.toLocaleString()}
                </p>
                <p style="margin: 0; color: #6b7280; font-size: 10px;">Contado</p>
              </div>

              <p style="margin: 0; color: #6b7280; font-size: 10px; font-weight: bold;">Cuotas:</p>
              <div style="font-size: 9px; color: #374151; line-height: 1.3;">
                <p style="margin: 2px 0;">4x \$${p.preciosCuotas?.[4] || 0}</p>
                <p style="margin: 2px 0;">6x \$${p.preciosCuotas?.[6] || 0}</p>
                <p style="margin: 2px 0;">8x \$${p.preciosCuotas?.[8] || 0}</p>
                <p style="margin: 2px 0;">Q \$${p.preciosCuotas?.quincena || 0}</p>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    html += `
        </div>

        <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 10px;">
          <p style="margin: 0;">Precios sujetos a cambios sin previo aviso</p>
        </div>
      </div>
    `;

    const element = document.createElement('div');
    element.innerHTML = html;

    const options = {
      margin: 8,
      filename: 'Catalogo-Productos.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    };

    html2pdf().set(options).from(element).save();

    Swal.fire({
      icon: 'success',
      title: 'PDF generado',
      text: '10 productos por página',
      toast: true,
      position: 'top-end',
      timer: 2000,
      showConfirmButton: false
    });
  };

  document.head.appendChild(script);
}

// ===============================
// NUEVA VENTA
// ===============================

function nuevaVentaHTML() {
  return `
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">

      <div class="bg-white rounded-3xl p-6 shadow-xl">

        <h2 class="text-3xl font-black mb-6">Nueva Venta</h2>

        <select id="clienteSelect" class="w-full p-4 border rounded-2xl mb-4">
          <option value="">Seleccionar Cliente</option>
          ${db.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>

        <select id="productoSelect" onchange="agregarAlCarrito()" class="w-full p-4 border rounded-2xl">
          <option value="">Seleccionar Producto</option>
          ${db.productos.filter(p => p.stock > 0).map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
        </select>

        <div id="carritoLista" class="mt-6 space-y-4"></div>

      </div>

      <div class="bg-white rounded-3xl p-6 shadow-xl">

        <h2 class="text-3xl font-black mb-6">Resumen</h2>

        <select id="cuotasSelect" onchange="calcularTotal()" class="w-full p-4 border rounded-2xl">
          <option value="1">Contado</option>
          <option value="4">4 cuotas</option>
          <option value="6">6 cuotas</option>
          <option value="8">8 cuotas</option>
          <option value="quincena">Quincena</option>
        </select>

        <div class="mt-8">
          <p class="text-gray-500">Total Final</p>
          <h1 id="totalFinal" class="text-5xl font-black text-green-600 mt-2">$0</h1>
        </div>

        <button onclick="finalizarVenta()" class="w-full mt-10 bg-green-600 hover:bg-green-700 text-white py-5 rounded-3xl text-xl font-black">
          Finalizar Venta
        </button>

      </div>

    </div>
  `;
}

function agregarAlCarrito() {
  const id = document.getElementById('productoSelect').value;
  if(!id) return;

  const producto = db.productos.find(p => p.id == id);
  const existe = carrito.find(i => i.id == id);

  if(existe) {
    existe.cantidad++;
  } else {
    carrito.push({ ...producto, cantidad: 1 });
  }

  actualizarCarrito();
  document.getElementById('productoSelect').value = '';
}

function actualizarCarrito() {
  const container = document.getElementById('carritoLista');
  if(!container) return;

  if(carrito.length === 0) {
    container.innerHTML = `<div class="text-center py-10 text-gray-400">Carrito vacío</div>`;
    calcularTotal();
    return;
  }

  container.innerHTML = carrito.map((item, index) => `
    <div class="bg-gray-100 rounded-2xl p-4 flex justify-between items-center">
      <div>
        <h3 class="font-black">${item.nombre}</h3>
        <p class="text-sm text-gray-500">Cantidad: ${item.cantidad}</p>
      </div>
      <div class="flex gap-2">
        <button onclick="restarCantidad(${index})" class="w-10 h-10 rounded-xl bg-white">-</button>
        <button onclick="sumarCantidad(${index})" class="w-10 h-10 rounded-xl bg-white">+</button>
      </div>
    </div>
  `).join('');

  calcularTotal();
}

function sumarCantidad(index) {
  carrito[index].cantidad++;
  actualizarCarrito();
}

function restarCantidad(index) {
  carrito[index].cantidad--;
  if(carrito[index].cantidad <= 0) {
    carrito.splice(index, 1);
  }
  actualizarCarrito();
}

function calcularTotal() {
  const cuotasValue = document.getElementById('cuotasSelect')?.value || '1';
  let total = 0;

  carrito.forEach(item => {
    let precio = 0;

    if(cuotasValue === '1') {
      precio = item.precioContado;
    } else if(cuotasValue === 'quincena') {
      precio = item.preciosCuotas?.quincena || 0;
    } else {
      const cuotas = Number(cuotasValue);
      precio = (item.preciosCuotas?.[cuotas] || 0) * cuotas;
    }

    total += precio * item.cantidad;
  });

  const totalFinal = document.getElementById('totalFinal');
  if(totalFinal) {
    totalFinal.innerHTML = '$' + total.toLocaleString();
  }
}

function finalizarVenta() {
  if (carrito.length === 0) {
    return Swal.fire({ icon: 'warning', title: 'Carrito vacío' });
  }

  const clienteId = document.getElementById('clienteSelect').value;
  if (!clienteId) {
    return Swal.fire({ icon: 'warning', title: 'Selecciona un cliente' });
  }

  const cliente = db.clientes.find(c => c.id == clienteId);
  const cuotasValue = document.getElementById('cuotasSelect').value;

  let total = 0;
  const itemsVenta = [];

  carrito.forEach(item => {
    let precioUnitario = 0;
    let cuotasTotales = 1;

    if(cuotasValue === '1') {
      precioUnitario = item.precioContado;
      cuotasTotales = 1;
    } else if(cuotasValue === 'quincena') {
      precioUnitario = item.preciosCuotas?.quincena || item.precioContado;
      cuotasTotales = 'quincena';
    } else {
      cuotasTotales = Number(cuotasValue);
      precioUnitario = item.preciosCuotas?.[cuotasTotales] || item.precioContado;
    }

    const subtotal = cuotasValue === 'quincena'
      ? precioUnitario * item.cantidad
      : (precioUnitario * cuotasTotales) * item.cantidad;

    total += subtotal;

    itemsVenta.push({
      nombre: item.nombre,
      cantidad: item.cantidad,
      precio: precioUnitario,
      subtotal: subtotal
    });
  });

  db.ventaCounter++;

  let cuotasTotalesVenta = 1;
  if (cuotasValue === 'quincena') {
    cuotasTotalesVenta = 'quincena';
  } else if (cuotasValue !== '1') {
    cuotasTotalesVenta = Number(cuotasValue);
  }

  const venta = {
    id: db.ventaCounter,
    fecha: new Date().toLocaleDateString('es-AR'),
    clienteNombre: cliente.nombre,
    items: itemsVenta,
    total: total,
    cuotasTotales: cuotasTotalesVenta,
    cuotasPagadas: 0,
    saldo: cuotasValue === '1' ? 0 : total,
    pagado: cuotasValue === '1' ? total : 0
  };

  db.ventas.push(venta);

  carrito.forEach(item => {
    const prod = db.productos.find(p => p.id === item.id);
    if (prod) {
      prod.stock -= item.cantidad;
    }
  });

  cliente.compras = (cliente.compras || 0) + total;

  saveDB();
  carrito = [];

  Swal.fire({
    icon: 'success',
    title: 'Venta registrada correctamente',
    toast: true,
    position: 'top-end',
    timer: 2500,
    showConfirmButton: false
  });

  showTab(5);
}

// ===============================
// PAGOS
// ===============================

function pagosHTML() {
  const pendientes = db.ventas.filter(v => v.saldo > 0);
  const totalPendiente = pendientes.reduce((a, v) => a + v.saldo, 0);

  return `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-3xl font-bold">Pagos Pendientes</h2>
        <p class="text-gray-500 text-sm mt-1">Clientes con cuotas activas</p>
      </div>
    </div>

    <div class="bg-gradient-to-r from-red-600 to-red-500 text-white p-6 rounded-3xl shadow-xl mb-8">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-red-100">Total a Cobrar</p>
          <h2 class="text-4xl font-black mt-2">$${totalPendiente.toLocaleString()}</h2>
        </div>
        <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">💰</div>
      </div>
    </div>

    <div class="space-y-5">
      ${pendientes.map(v => {
        let productos = '';
        if (Array.isArray(v.items)) {
          productos = v.items.map(item => `
            <div class="flex justify-between text-sm py-1">
              <span class="text-gray-700">${item.nombre}</span>
              <span class="font-semibold text-gray-500">x${item.cantidad}</span>
            </div>
          `).join('');
        }

        return `
          <div class="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <div class="flex justify-between items-start gap-4">
              <div class="flex-1">
                <h3 class="font-bold text-lg">${v.clienteNombre}</h3>
                <div class="mt-3 bg-gray-50 rounded-2xl p-3">
                  ${productos}
                </div>
              </div>

              <div class="text-right">
                <p class="text-red-600 text-2xl font-bold">$${v.saldo.toLocaleString()}</p>
                <p class="text-sm text-gray-500 mt-1">
                  ${typeof v.cuotasTotales === 'string' ? v.cuotasTotales : v.cuotasPagadas + '/' + v.cuotasTotales + ' cuotas'}
                </p>
              </div>
            </div>

            <button onclick="registrarPago(${v.id})" class="mt-5 w-full bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-semibold transition">
              Registrar Pago
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function registrarPago(id) {
  const venta = db.ventas.find(v => v.id == id);

  let monto = 0;
  if (venta.cuotasTotales === 'quincena') {
    monto = venta.total;
  } else {
    monto = Math.round(venta.total / venta.cuotasTotales);
  }

  Swal.fire({
    title:`Registrar pago de $${monto}?`,
    icon:'question',
    showCancelButton:true
  }).then(r => {
    if(r.isConfirmed) {
      venta.saldo -= monto;

      if (venta.cuotasTotales !== 'quincena') {
        venta.cuotasPagadas++;
      }

      if(venta.saldo < 0) {
        venta.saldo = 0;
      }

      saveDB();
      generarComprobantesPago(venta, monto);

      const cliente = db.clientes.find(c => c.nombre === venta.clienteNombre);

      Swal.fire({
        title: 'Pago registrado',
        icon: 'success',
        html: `<p>¿Enviar comprobante por WhatsApp?</p>`,
        showCancelButton: true,
        confirmButtonText: 'Enviar',
        cancelButtonText: 'No ahora'
      }).then(result => {
        if (result.isConfirmed) {
          if (cliente && cliente.telefono) {
            enviarComprobanteWhatsAppCliente(venta, monto, cliente);
          } else {
            Swal.fire({
              icon: 'warning',
              title: 'Sin número de teléfono',
              text: 'El cliente no tiene teléfono registrado'
            });
          }
        }
        showTab(5);
      });
    }
  });
}

// ===============================
// GENERAR COMPROBANTE DE PAGO
// ===============================

function generarComprobantesPago(venta, monto) {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-AR');
  const hora = ahora.toLocaleTimeString('es-AR');

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

  script.onload = function() {
    let cuotasInfo = '';

    if (venta.cuotasTotales === 1) {
      cuotasInfo = '<p style="margin: 8px 0; color: #374151;"><strong>PAGO UNICO - CONTADO</strong></p>';
    } else if (venta.cuotasTotales === 'quincena') {
      cuotasInfo = '<p style="margin: 8px 0; color: #374151;"><strong>PAGO POR QUINCENA</strong></p>';
    } else {
      const faltanCuotas = venta.cuotasTotales - venta.cuotasPagadas;
      cuotasInfo = `
        <p style="margin: 8px 0; color: #374151;">
          <strong>Cuota:</strong> ${venta.cuotasPagadas} de ${venta.cuotasTotales}
        </p>
        <p style="margin: 8px 0; color: #374151;">
          <strong>Cuotas restantes:</strong> ${faltanCuotas}
        </p>
        <p style="margin: 8px 0; color: #ef4444;">
          <strong>Monto restante:</strong> $${venta.saldo.toLocaleString()}
        </p>
      `;
    }

    let itemsHtml = '';
    venta.items.forEach(item => {
      itemsHtml += `
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px; text-align: left; color: #374151;">${item.nombre}</td>
          <td style="padding: 8px; text-align: center; color: #374151;">x${item.cantidad}</td>
          <td style="padding: 8px; text-align: right; color: #374151;">$${item.precio.toLocaleString()}</td>
          <td style="padding: 8px; text-align: right; color: #374151;">$${item.subtotal.toLocaleString()}</td>
        </tr>
      `;
    });

    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background: white;">

        <div style="text-align: center; margin-bottom: 30px; border-bottom: 3px solid #2563eb; padding-bottom: 20px;">
          <h1 style="margin: 0; color: #2563eb; font-size: 28px;">COMPROBANTE DE PAGO</h1>
          <p style="margin: 5px 0 0 0; color: #6b7280; font-size: 14px;">Transacción registrada</p>
        </div>

        <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 5px 0; color: #374151;"><strong>Fecha:</strong> ${fecha}</p>
          <p style="margin: 5px 0; color: #374151;"><strong>Hora:</strong> ${hora}</p>
        </div>

        <div style="margin-bottom: 25px;">
          <h3 style="margin: 0 0 10px 0; color: #1f2937; font-size: 16px;">DATOS DEL CLIENTE</h3>
          <p style="margin: 5px 0; color: #374151;"><strong>Nombre:</strong> ${venta.clienteNombre}</p>
          <p style="margin: 5px 0; color: #374151;"><strong>N° Venta:</strong> ${venta.id}</p>
        </div>

        <div style="margin-bottom: 25px;">
          <h3 style="margin: 0 0 10px 0; color: #1f2937; font-size: 16px;">ARTÍCULOS PAGADOS</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f3f4f6; border-bottom: 2px solid #d1d5db;">
                <th style="padding: 10px; text-align: left; color: #1f2937; font-weight: bold;">Artículo</th>
                <th style="padding: 10px; text-align: center; color: #1f2937; font-weight: bold;">Cant.</th>
                <th style="padding: 10px; text-align: right; color: #1f2937; font-weight: bold;">Precio</th>
                <th style="padding: 10px; text-align: right; color: #1f2937; font-weight: bold;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>

        <div style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin-bottom: 25px;">
          <p style="margin: 8px 0; color: #374151;"><strong>Monto pagado en esta transacción:</strong></p>
          <p style="margin: 8px 0; color: #16a34a; font-size: 24px; font-weight: bold;">$${monto.toLocaleString()}</p>
        </div>

        <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="margin: 0 0 10px 0; color: #1f2937; font-size: 14px; font-weight: bold;">ESTADO DE CUOTAS</h3>
          ${cuotasInfo}
        </div>

        <div style="text-align: center; padding: 30px; border-top: 2px solid #e5e7eb; margin-top: 30px;">
          <h2 style="margin: 0 0 10px 0; color: #2563eb; font-size: 20px; font-weight: bold;">
            Muchas gracias por tu compra!
          </h2>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">
            Esperamos verte pronto
          </p>
        </div>

        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px;">
          <p style="margin: 5px 0;">Este comprobante es válido como recibo de pago</p>
          <p style="margin: 5px 0;">Por cualquier consulta, contáctenos</p>
        </div>

      </div>
    `;

    const element = document.createElement('div');
    element.innerHTML = html;

    const options = {
      margin: 5,
      filename: 'Comprobante-Pago-' + venta.id + '.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    };

    html2pdf().set(options).from(element).save();
  };

  document.head.appendChild(script);
}

// ===============================
// HISTORIAL DE VENTAS
// ===============================

function historialVentasHTML() {
  const completadas = db.ventas.filter(v => v.saldo === 0);

  if (completadas.length === 0) {
    return `
      <div class="text-center py-20">
        <h1 class="text-3xl font-black text-gray-800 mb-4">Historial de Ventas</h1>
        <p class="text-gray-500 mb-8">Las ventas completadas aparecerán aquí</p>
        <div class="text-6xl mb-4">📭</div>
        <p class="text-gray-400">No hay ventas completadas aún</p>
      </div>
    `;
  }

  return `
    <div class="mb-8">
      <h1 class="text-3xl font-black text-gray-800">Historial de Ventas</h1>
      <p class="text-gray-500 mt-2">Ventas completadas y pagadas</p>
    </div>

    <div class="space-y-5">
      ${completadas.map(v => {
        let productos = '';
        if (Array.isArray(v.items)) {
          productos = v.items.map(item => `
            <div class="flex justify-between text-sm py-1">
              <span class="text-gray-700">${item.nombre} x${item.cantidad}</span>
              <span class="font-semibold text-gray-500">$${item.subtotal.toLocaleString()}</span>
            </div>
          `).join('');
        }

        return `
          <div class="bg-white rounded-3xl shadow-sm border border-green-100 p-5">
            <div class="flex justify-between items-start gap-4">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="font-bold text-lg text-gray-800">${v.clienteNombre}</h3>
                  <span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">✓ Pagada</span>
                </div>

                <p class="text-gray-500 text-sm mt-1">Fecha: ${v.fecha}</p>

                <div class="mt-3 bg-green-50 rounded-2xl p-3">
                  ${productos}
                </div>
              </div>

              <div class="text-right">
                <p class="text-green-600 text-2xl font-bold">$${v.total.toLocaleString()}</p>
                <p class="text-sm text-gray-500 mt-1">
                  ${typeof v.cuotasTotales === 'string' ? v.cuotasTotales : (v.cuotasTotales === 1 ? 'Contado' : v.cuotasTotales + ' cuotas')}
                </p>
              </div>
            </div>

            <div class="flex gap-2 mt-4 pt-4 border-t border-green-200">
              <button onclick="reenviirComprobanteHistorial(${v.id})" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-2xl font-semibold text-sm">
                📄 Reenviar PDF
              </button>
              <button onclick="enviarComprobanteWhatsAppHistorial(${v.id})" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-2xl font-semibold text-sm">
                💬 WhatsApp
              </button>
              <button onclick="borrarPago(${v.id})" class="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-2xl font-semibold text-sm">
                🗑️ Borrar
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ===============================
// NORMALIZAR NUMERO WHATSAPP
// ===============================

function normalizarNumeroWhatsApp(telefono) {
  if (!telefono) return null;

  let numero = telefono.replace(/[\s\-()]/g, '');

  if (numero.startsWith('+')) {
    return numero;
  }

  if (numero.startsWith('54')) {
    if (numero.length > 2) {
      return '+' + numero;
    }
  }

  if (numero.startsWith('9') && numero.length > 9) {
    return '+54' + numero;
  }

  if (!numero.startsWith('9') && numero.length === 10) {
    return '+549' + numero;
  }

  return '+54' + numero;
}

// ===============================
// ENVIAR COMPROBANTE POR WHATSAPP
// ===============================

function enviarComprobanteWhatsApp(venta, monto) {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-AR');
  const hora = ahora.toLocaleTimeString('es-AR');

  let cuotasInfo = '';

  if (venta.cuotasTotales === 1) {
    cuotasInfo = 'PAGO UNICO - CONTADO';
  } else if (venta.cuotasTotales === 'quincena') {
    cuotasInfo = 'PAGO POR QUINCENA';
  } else {
    const faltanCuotas = venta.cuotasTotales - venta.cuotasPagadas;
    cuotasInfo = `Cuota: ${venta.cuotasPagadas} de ${venta.cuotasTotales}\nCuotas restantes: ${faltanCuotas}\nMonto restante: $${venta.saldo.toLocaleString()}`;
  }

  let itemsTexto = '';
  venta.items.forEach(item => {
    itemsTexto += `\n- ${item.nombre} x${item.cantidad}: $${item.subtotal.toLocaleString()}`;
  });

  let texto =
    `COMPROBANTE DE PAGO\n` +
    `==================\n\n` +
    `Fecha: ${fecha}\n` +
    `Hora: ${hora}\n\n` +
    `CLIENTE: ${venta.clienteNombre}\n` +
    `N° Venta: ${venta.id}\n\n` +
    `ARTICULOS PAGADOS:\n` +
    itemsTexto + `\n\n` +
    `MONTO PAGADO: $${monto.toLocaleString()}\n\n` +
    `ESTADO DE CUOTAS:\n` +
    cuotasInfo + `\n\n` +
    `==================\n` +
    `Muchas gracias por tu compra!\n` +
    `Esperamos verte pronto`;

  window.open(
    `https://wa.me/?text=${encodeURIComponent(texto)}`,
    '_blank'
  );
}

function enviarComprobanteWhatsAppCliente(venta, monto, cliente) {
  generarComprobantesPago(venta, monto);

  const numeroWhatsApp = normalizarNumeroWhatsApp(cliente.telefono);

  if (!numeroWhatsApp) {
    Swal.fire({
      icon: 'error',
      title: 'Número inválido',
      text: 'No se pudo procesar el número de teléfono del cliente'
    });
    return;
  }

  setTimeout(() => {
    let mensaje = `Hola ${cliente.nombre}, te envío el comprobante de pago.\n\n`;

    window.open(
      `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`,
      '_blank'
    );
  }, 1500);
}

function reenviirComprobanteHistorial(ventaId) {
  const venta = db.ventas.find(v => v.id == ventaId);
  let monto = 0;

  if (venta.cuotasTotales === 'quincena') {
    monto = venta.total;
  } else {
    monto = Math.round(venta.total / venta.cuotasTotales);
  }

  generarComprobantesPago(venta, monto);

  Swal.fire({
    icon: 'success',
    title: 'Comprobante generado',
    text: 'El PDF se está descargando',
    toast: true,
    position: 'top-end',
    timer: 2000,
    showConfirmButton: false
  });
}

function enviarComprobanteWhatsAppHistorial(ventaId) {
  const venta = db.ventas.find(v => v.id == ventaId);
  const cliente = db.clientes.find(c => c.nombre === venta.clienteNombre);
  let monto = 0;

  if (venta.cuotasTotales === 'quincena') {
    monto = venta.total;
  } else {
    monto = Math.round(venta.total / venta.cuotasTotales);
  }

  if (cliente && cliente.telefono) {
    enviarComprobanteWhatsAppCliente(venta, monto, cliente);
  } else {
    Swal.fire({
      icon: 'warning',
      title: 'Sin número de teléfono',
      text: 'El cliente no tiene teléfono registrado'
    });
  }
}

function borrarPago(ventaId) {
  Swal.fire({
    title: '¿Borrar esta venta?',
    text: 'Se restaurará el stock y se eliminará del historial',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sí, borrar',
    cancelButtonText: 'Cancelar'
  }).then(r => {
    if (r.isConfirmed) {
      const venta = db.ventas.find(v => v.id == ventaId);

      if (venta) {
        venta.items.forEach(item => {
          const producto = db.productos.find(p => p.nombre === item.nombre);
          if (producto) {
            producto.stock += item.cantidad;
          }
        });

        const cliente = db.clientes.find(c => c.nombre === venta.clienteNombre);
        if (cliente) {
          cliente.compras = (cliente.compras || 0) - venta.total;
          if (cliente.compras < 0) cliente.compras = 0;
        }

        db.ventas = db.ventas.filter(v => v.id != ventaId);

        saveDB();

        Swal.fire({
          icon: 'success',
          title: 'Venta eliminada',
          text: 'Stock restaurado',
          toast: true,
          position: 'top-end',
          timer: 2000,
          showConfirmButton: false
        });

        showTab(6);
      }
    }
  });
}

// ===============================
// WHATSAPP MEJORADO
// ===============================

function compartirPorWhatsApp() {
  let texto =
    '========================\n' +
    '       CATALOGO 2024\n' +
    '========================\n\n';

  db.productos.forEach((p, index) => {
    texto +=
      `${index + 1}. ${p.nombre.toUpperCase()}\n` +
      `------------------------\n` +
      `\n` +
      `PRECIO CONTADO: $${p.precioContado.toLocaleString()}\n` +
      `\n` +
      `Opciones de pago:\n` +
      `- 4 cuotas de $${p.preciosCuotas?.[4] || 0} (Total: $${((p.preciosCuotas?.[4] || 0) * 4).toLocaleString()})\n` +
      `- 6 cuotas de $${p.preciosCuotas?.[6] || 0} (Total: $${((p.preciosCuotas?.[6] || 0) * 6).toLocaleString()})\n` +
      `- 8 cuotas de $${p.preciosCuotas?.[8] || 0} (Total: $${((p.preciosCuotas?.[8] || 0) * 8).toLocaleString()})\n` +
      `- Quincena: $${p.preciosCuotas?.quincena || 0} (cada 15 dias)\n` +
      `\n` +
      `Stock disponible: ${p.stock} unidades\n\n`;
  });

  texto +=
    '------------------------\n' +
    'Consulta sin compromiso\n' +
    'Preguntas? Estoy para ayudarte!\n';

  window.open(
    `https://wa.me/?text=${encodeURIComponent(texto)}`,
    '_blank'
  );
}

// ===============================
// EXPORTAR DATOS
// ===============================

function descargarDatos() {
  const datosExportar = {
    clientes: db.clientes,
    productos: db.productos,
    ventas: db.ventas,
    pagos: db.pagos,
    ventaCounter: db.ventaCounter,
    fechaExporto: new Date().toLocaleString('es-AR')
  };

  const json = JSON.stringify(datosExportar, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `datos-tienda-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  Swal.fire({
    icon: 'success',
    title: 'Datos descargados',
    text: 'El archivo se guardó en descargas',
    toast: true,
    position: 'top-end',
    timer: 2000,
    showConfirmButton: false
  });
}

function cargarDatos() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const datos = JSON.parse(event.target.result);

        if (!datos.clientes || !datos.productos || !datos.ventas) {
          throw new Error('Archivo inválido');
        }

        Swal.fire({
          title: '¿Reemplazar todos los datos?',
          text: 'Se reemplazarán clientes, productos, ventas y pagos',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Sí, reemplazar',
          cancelButtonText: 'Cancelar'
        }).then(result => {
          if (result.isConfirmed) {
            db.clientes = datos.clientes || [];
            db.productos = datos.productos || [];
            db.ventas = datos.ventas || [];
            db.pagos = datos.pagos || [];
            db.ventaCounter = datos.ventaCounter || 0;

            saveDB();

            Swal.fire({
              icon: 'success',
              title: 'Datos cargados',
              text: 'Los datos se han importado correctamente',
              confirmButtonText: 'Recargar app'
            }).then(() => {
              location.reload();
            });
          }
        });

      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Error al cargar',
          text: 'El archivo no es válido o está corrupto'
        });
      }
    };

    reader.readAsText(file);
  };

  input.click();
}

// ===============================
// FUNCIONES DE MODAL
// ===============================

function abrirModal() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.zIndex = '9999';
    modal.style.display = 'flex';
  }
}

function cerrarModal() {
  document.getElementById('modal').classList.add('hidden');
}

function cerrarModalImproved() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  const inputs = modal?.querySelectorAll('input');
  if (inputs) {
    inputs.forEach(input => input.value = '');
  }
}

// ===============================
// INIT
// ===============================

function mostrarPantallaDeCargar() {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = `
      <div class="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div class="bg-white rounded-3xl shadow-2xl p-8 text-center">
          <div class="mb-6">
            <div class="inline-block">
              <div class="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
            </div>
          </div>
          <h2 class="text-2xl font-black text-gray-800 mb-2">Mi Tienda</h2>
          <p class="text-gray-500 mb-4">Cargando app...</p>
          <p class="text-xs text-gray-400">Preparando datos</p>
        </div>
      </div>
    `;
  }
}

async function inicializarApp() {
  try {
    mostrarPantallaDeCargar();
    await new Promise(r => setTimeout(r, 500));

    console.log('Iniciando sincronización...');
    await cargarDatosFirebase();

    console.log('App lista, mostrando dashboard...');
    showTab(0);

    console.log('✓ App cargada exitosamente');
    console.log(`  - Clientes: ${db.clientes.length}`);
    console.log(`  - Productos: ${db.productos.length}`);
    console.log(`  - Ventas: ${db.ventas.length}`);

  } catch (error) {
    console.error('Error en inicialización:', error);
    showTab(0);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarApp);
} else {
  inicializarApp();
}

// FUNCIÓN AGREGADA PARA QUINCENA
function mostrarTotalQuincena() {
  const valor = Number(document.getElementById('cquincena').value) || 0;
  document.getElementById('infoquincena').innerHTML = `Total (2 quincenas): $${(valor * 2).toLocaleString()}`;
}
