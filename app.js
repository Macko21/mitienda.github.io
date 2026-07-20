// ===============================
// BASE DE DATOS
// ===============================

let db = {
  clientes: JSON.parse(localStorage.getItem('clientes')) || [],
  productos: JSON.parse(localStorage.getItem('productos')) || [],
  ventas: JSON.parse(localStorage.getItem('ventas')) || [],
  pagos: JSON.parse(localStorage.getItem('pagos')) || [],
  pedidos: JSON.parse(localStorage.getItem('pedidos')) || [],
  ventaCounter: parseInt(localStorage.getItem('ventaCounter')) || 0,
  pedidoCounter: parseInt(localStorage.getItem('pedidoCounter')) || 0
};

let carrito = [];

// ===============================
// CACHE DE IMAGENES CON INDEXEDDB
// ===============================

let dbImagenes;

function inicializarCacheImagenes() {
  const request = indexedDB.open('TiendaImagenes', 1);
  request.onerror = () => console.log('Error al abrir IndexedDB');
  request.onsuccess = (e) => { dbImagenes = e.target.result; };
  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('imagenes')) {
      db.createObjectStore('imagenes', { keyPath: 'id' });
    }
  };
}

function obtenerImagenCacheada(productoId) {
  return new Promise((resolve) => {
    if (!dbImagenes) { resolve(null); return; }
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
// SUPABASE — GUARDAR Y CARGAR
// ===============================

async function saveDB() {
  const ahora = new Date().toISOString();
  // Siempre guardar en localStorage como backup
  localStorage.setItem('clientes', JSON.stringify(db.clientes));
  localStorage.setItem('productos', JSON.stringify(db.productos));
  localStorage.setItem('ventas', JSON.stringify(db.ventas));
  localStorage.setItem('pagos', JSON.stringify(db.pagos));
  localStorage.setItem('pedidos', JSON.stringify(db.pedidos));
  localStorage.setItem('ventaCounter', db.ventaCounter.toString());
  localStorage.setItem('pedidoCounter', db.pedidoCounter.toString());
  localStorage.setItem('ultimaActualizacion', ahora);

  // Supabase: productos sin fotos (las fotos son demasiado grandes)
  const productosParaCloud = db.productos.map(({ foto, ...resto }) => resto);

  const datos = {
    clientes: db.clientes,
    productos: productosParaCloud,
    ventas: db.ventas,
    pagos: db.pagos,
    pedidos: db.pedidos,
    ventaCounter: db.ventaCounter,
    pedidoCounter: db.pedidoCounter,
    ultimaActualizacion: ahora
  };

  try {
    const sb = window._supabase;
    if (!sb) return;
    const { error } = await sb.from('tienda').upsert({ id: 'oneshop', datos });
    if (error) console.error('Error guardando en Supabase:', error.message);
  } catch (e) {
    console.error('Error Supabase saveDB:', e);
  }
}

async function cargarDatosSupabase() {
  try {
    const sb = window._supabase;
    if (!sb) return null;
    const { data, error } = await sb.from('tienda').select('datos').eq('id', 'oneshop').single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data?.datos || null;
  } catch (e) {
    console.error('Error cargando desde Supabase:', e);
    return null;
  }
}

function suscribirCambiosSupabase() {
  const sb = window._supabase;
  if (!sb) return;
  sb.channel('tienda-cambios')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tienda' }, (payload) => {
      const datos = payload.new?.datos;
      if (!datos) return;
      const localTs = localStorage.getItem('ultimaActualizacion');
      const cloudTs = datos.ultimaActualizacion || '';
      if (!cloudTs || (localTs && cloudTs <= localTs)) return;
      aplicarDatosCloud(datos);
      showTab(currentTab);
      console.log('Datos actualizados en tiempo real');
    })
    .subscribe();
}

function aplicarDatosCloud(datos) {
  db.clientes = datos.clientes || [];
  db.ventas = datos.ventas || [];
  db.pagos = datos.pagos || [];
  db.pedidos = datos.pedidos || [];
  db.ventaCounter = datos.ventaCounter || 0;
  db.pedidoCounter = datos.pedidoCounter || 0;

  const productosCloud = datos.productos || [];
  const productosLocales = JSON.parse(localStorage.getItem('productos') || '[]');
  db.productos = productosCloud.map(pc => {
    const local = productosLocales.find(pl => pl.id == pc.id);
    return { ...pc, foto: local?.foto || null };
  });
  productosLocales.forEach(pl => {
    if (!db.productos.find(p => p.id == pl.id)) db.productos.push(pl);
  });

  localStorage.setItem('clientes', JSON.stringify(db.clientes));
  localStorage.setItem('productos', JSON.stringify(db.productos));
  localStorage.setItem('ventas', JSON.stringify(db.ventas));
  localStorage.setItem('pagos', JSON.stringify(db.pagos));
  localStorage.setItem('pedidos', JSON.stringify(db.pedidos));
  localStorage.setItem('ventaCounter', db.ventaCounter.toString());
  localStorage.setItem('pedidoCounter', db.pedidoCounter.toString());
  localStorage.setItem('ultimaActualizacion', datos.ultimaActualizacion || new Date().toISOString());
}

// ── Formato de número de venta: 00001 ────────────────────────────────────────
function fmtId(n) { return String(n).padStart(5, '0'); }

function toggleMenu() {
  document.getElementById('sidebar').classList.toggle('sidebar-hidden');
  document.getElementById('overlay').classList.toggle('hidden');
}

// ===============================
// TABS
// ===============================

let currentTab = 0;

function showTab(n) {
  currentTab = n;
  for (let i = 0; i <= 7; i++) {
    const btn = document.getElementById('tab' + i);
    if (btn) btn.classList.remove('tab-active');
  }
  const activeBtn = document.getElementById('tab' + n);
  if (activeBtn) activeBtn.classList.add('tab-active');

  const content = document.getElementById('content');
  switch (n) {
    case 0: content.innerHTML = dashboardHTML(); break;
    case 1: content.innerHTML = clientesHTML(); break;
    case 2: content.innerHTML = articulosHTML(); break;
    case 3: content.innerHTML = catalogoHTML(); break;
    case 4:
      content.innerHTML = nuevaVentaHTML();
      setTimeout(() => actualizarCarrito(), 50);
      break;
    case 5: content.innerHTML = pagosHTML(); break;
    case 6: content.innerHTML = historialVentasHTML(); break;
    case 7: content.innerHTML = pedidosHTML(); break;
  }
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.add('sidebar-hidden');
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ===============================
// DASHBOARD
// ===============================

function dashboardHTML() {
  const total = db.ventas.reduce((a, v) => a + (v.total || 0), 0);
  const pendientes = db.ventas.filter(v => v.saldo > 0).length;

  const ultVentas = [...db.ventas]
    .sort((a, b) => (b.id || 0) - (a.id || 0))
    .slice(0, 5);

  const todosLosPagos = [];
  db.ventas.forEach(v => {
    if (v.historialPagos?.length) {
      v.historialPagos.forEach(p => {
        todosLosPagos.push({
          ventaId: v.id,
          clienteNombre: v.clienteNombre,
          monto: p.monto,
          fecha: p.fecha
        });
      });
    } else if (v.pagado > 0) {
      todosLosPagos.push({
        ventaId: v.id,
        clienteNombre: v.clienteNombre,
        monto: v.pagado,
        fecha: v.fecha
      });
    }
  });
  todosLosPagos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const ultPagos = todosLosPagos.slice(0, 5);

  const fmtFecha = f => {
    if (!f) return '';
    if (typeof f === 'string' && f.includes('/')) return f;
    const d = new Date(f);
    return isNaN(d) ? String(f) : d.toLocaleDateString('es-AR');
  };

  const hoy = new Date().toLocaleDateString('es-AR');
  const cobradoHoy = todosLosPagos
    .filter(p => fmtFecha(p.fecha) === hoy)
    .reduce((s, p) => s + p.monto, 0);

  const pedidosPendientes = db.pedidos.filter(p => p.estado === 'pendiente').length;

  return `
    <div class="mb-8">
      <h1 class="text-3xl md:text-4xl font-black text-gray-800">Dashboard</h1>
      <p class="text-gray-500 mt-2">Resumen general del negocio</p>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
      <div class="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-6 rounded-3xl shadow-xl">
        <div class="flex items-center justify-between">
          <div><p class="text-blue-100">Total Vendido</p><h2 class="text-4xl font-black mt-2">$${total.toLocaleString()}</h2></div>
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">💰</div>
        </div>
      </div>
      <div class="bg-white p-6 rounded-3xl shadow-xl border border-gray-100">
        <div class="flex items-center justify-between">
          <div><p class="text-gray-500">Clientes</p><h2 class="text-4xl font-black mt-2 text-gray-800">${db.clientes.length}</h2></div>
          <div class="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center text-3xl">👥</div>
        </div>
      </div>
      <div class="bg-white p-6 rounded-3xl shadow-xl border border-gray-100">
        <div class="flex items-center justify-between">
          <div><p class="text-gray-500">Artículos</p><h2 class="text-4xl font-black mt-2 text-gray-800">${db.productos.length}</h2></div>
          <div class="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center text-3xl">📦</div>
        </div>
      </div>
      <div class="bg-gradient-to-r from-orange-500 to-red-500 text-white p-6 rounded-3xl shadow-xl">
        <div class="flex items-center justify-between">
          <div><p class="text-orange-100">Pagos Pendientes</p><h2 class="text-4xl font-black mt-2">${pendientes}</h2></div>
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">🧾</div>
        </div>
      </div>
    </div>

    <!-- Caja del día + Pedidos pendientes -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
      <div class="bg-gradient-to-r from-purple-600 to-purple-500 text-white p-6 rounded-3xl shadow-xl">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-purple-200 text-sm font-semibold">CAJA DEL DÍA — ${hoy}</p>
            <h2 class="text-4xl font-black mt-1">$${cobradoHoy.toLocaleString()}</h2>
            <p class="text-purple-200 text-xs mt-1">Total cobrado hoy entre ventas y cuotas</p>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">🏪</div>
        </div>
      </div>
      <div class="bg-gradient-to-r from-amber-500 to-orange-400 text-white p-6 rounded-3xl shadow-xl cursor-pointer" onclick="showTab(7)">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-amber-100 text-sm font-semibold">PEDIDOS PENDIENTES</p>
            <h2 class="text-4xl font-black mt-1">${pedidosPendientes}</h2>
            <p class="text-amber-100 text-xs mt-1">Tocá para ver el listado</p>
          </div>
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">📋</div>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div class="bg-white rounded-3xl shadow-xl p-6">
        <div class="flex items-center justify-between mb-5">
          <div>
            <h2 class="text-xl font-black text-gray-800">Últimas ventas</h2>
            <p class="text-xs text-gray-400 mt-0.5">Las 5 más recientes</p>
          </div>
          <div class="flex gap-2">
            <button onclick="descargarReporteVentas()"
              class="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-3 py-2 rounded-xl font-bold transition">
              📄 Descargar
            </button>
            <button onclick="showTab(6)"
              class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-xl font-bold transition">
              Ver todo →
            </button>
          </div>
        </div>

        ${ultVentas.length === 0
          ? `<div class="text-center py-10 text-gray-400"><div class="text-4xl mb-2">🛒</div><p>Sin ventas aún</p></div>`
          : `<div class="space-y-3">
              ${ultVentas.map(v => {
                const esQuincenal = v.esQuincenal || false;
                const badge = v.saldo === 0
                  ? `<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">✓ Pagada</span>`
                  : `<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">Pendiente</span>`;
                return `
                  <div class="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                    <div class="flex items-center gap-3">
                      <span class="text-xs font-black text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg min-w-[52px] text-center">#${fmtId(v.id)}</span>
                      <div>
                        <p class="font-bold text-gray-800 text-sm">${v.clienteNombre}</p>
                        <div class="flex items-center gap-2 mt-0.5">
                          <p class="text-xs text-gray-400">${v.fecha}</p>
                          ${badge}
                        </div>
                      </div>
                    </div>
                    <div class="text-right">
                      <p class="font-black text-gray-800">$${v.total.toLocaleString()}</p>
                      <p class="text-xs text-gray-400">${esQuincenal ? '🗓 Quincenal' : v.cuotasTotales === 1 ? 'Contado' : v.cuotasTotales + ' cuotas'}</p>
                    </div>
                  </div>`;
              }).join('')}
            </div>`
        }
      </div>

      <div class="bg-white rounded-3xl shadow-xl p-6">
        <div class="flex items-center justify-between mb-5">
          <div>
            <h2 class="text-xl font-black text-gray-800">Últimos pagos</h2>
            <p class="text-xs text-gray-400 mt-0.5">Los 5 más recientes</p>
          </div>
          <div class="flex gap-2">
            <button onclick="descargarReportePagos()"
              class="text-xs bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-3 py-2 rounded-xl font-bold transition">
              📄 Descargar
            </button>
            <button onclick="showTab(5)"
              class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-xl font-bold transition">
              Ver todo →
            </button>
          </div>
        </div>

        ${ultPagos.length === 0
          ? `<div class="text-center py-10 text-gray-400"><div class="text-4xl mb-2">💵</div><p>Sin pagos registrados</p></div>`
          : `<div class="space-y-3">
              ${ultPagos.map(p => `
                <div class="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                  <div class="flex items-center gap-3">
                    <span class="text-xs font-black text-purple-600 bg-purple-50 border border-purple-200 px-2 py-1 rounded-lg min-w-[52px] text-center">#${fmtId(p.ventaId)}</span>
                    <div>
                      <p class="font-bold text-gray-800 text-sm">${p.clienteNombre}</p>
                      <p class="text-xs text-gray-400">${fmtFecha(p.fecha)}</p>
                    </div>
                  </div>
                  <div class="text-right">
                    <p class="font-black text-green-600">+$${p.monto.toLocaleString()}</p>
                    <p class="text-xs text-gray-400">pago</p>
                  </div>
                </div>
              `).join('')}
            </div>`
        }
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
      <div><h1 class="text-3xl font-black text-gray-800">Clientes</h1><p class="text-gray-500">Administración de clientes</p></div>
      <button onclick="abrirFormularioCliente()" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-2xl font-bold shadow-lg">+ Nuevo Cliente</button>
    </div>
    <div class="space-y-4">
      ${db.clientes.map(c => `
        <div class="bg-white rounded-3xl p-5 shadow border border-gray-100">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="font-black text-lg text-gray-800">${c.nombre}</h3>
              <p class="text-gray-500 mt-1">📞 ${c.telefono || '-'}</p>
              ${c.direccion ? `<p class="text-gray-500">📍 ${c.direccion}</p>` : ''}
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

function abrirFormularioCliente(cliente = null) {
  document.getElementById('modalContent').innerHTML = `
    <div class="p-6">
      <h2 class="text-3xl font-black mb-6">${cliente ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Nombre</label>
        <input id="nombre" placeholder="Ej: Juan García" value="${cliente?.nombre || ''}"
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-500">
      </div>
      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Teléfono</label>
        <input id="telefono" placeholder="Ej: +54 9 11 1234567" value="${cliente?.telefono || ''}"
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-500">
      </div>
      <div class="mb-6">
        <label class="block text-sm font-bold text-gray-700 mb-2">Dirección</label>
        <input id="direccion" placeholder="Ej: San Martín 456, Necochea" value="${cliente?.direccion || ''}"
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-500">
      </div>
      <div class="grid grid-cols-2 gap-4">
        <button onclick="guardarCliente(${cliente ? cliente.id : 'null'})" class="bg-blue-600 text-white py-3 rounded-2xl font-bold hover:bg-blue-700">Guardar</button>
        <button onclick="cerrarModal()" class="bg-gray-200 py-3 rounded-2xl font-bold hover:bg-gray-300">Cancelar</button>
      </div>
    </div>
  `;
  document.getElementById('modal').classList.remove('hidden');
}

function guardarCliente(id) {
  const nombre = document.getElementById('nombre').value.trim();
  const telefono = document.getElementById('telefono').value.trim();
  if (!nombre) return Swal.fire({ icon: 'warning', title: 'Ingrese nombre' });
  if (id !== null) {
    const cliente = db.clientes.find(c => c.id == id);
    cliente.nombre = nombre;
    cliente.telefono = telefono;
    cliente.direccion = document.getElementById('direccion').value.trim();
  } else {
    db.clientes.push({ id: Date.now(), nombre, telefono, direccion: document.getElementById('direccion').value.trim(), compras: 0 });
  }
  saveDB(); cerrarModal(); showTab(1);
}

function editarCliente(id) { abrirFormularioCliente(db.clientes.find(c => c.id == id)); }

function eliminarCliente(id) {
  Swal.fire({ title: '¿Eliminar cliente?', icon: 'warning', showCancelButton: true }).then(r => {
    if (r.isConfirmed) { db.clientes = db.clientes.filter(c => c.id != id); saveDB(); showTab(1); }
  });
}

// ===============================
// ARTICULOS
// ===============================

function articulosHTML() {
  return `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
      <div><h1 class="text-3xl font-black text-gray-800">Artículos</h1><p class="text-gray-500">Gestión de stock y precios</p></div>
      <button onclick="abrirFormularioProducto()" class="bg-green-600 text-white px-6 py-4 rounded-2xl font-bold shadow-lg">+ Nuevo Artículo</button>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      ${db.productos.map(p => `
        <div class="bg-white rounded-3xl overflow-hidden shadow-xl border border-gray-100">
          <div class="w-full h-52 bg-gray-300 relative overflow-hidden">
            <img src="${p.foto || 'https://picsum.photos/500/300'}" loading="lazy" class="w-full h-52 object-cover"
              onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22500%22 height=%22300%22%3E%3Crect fill=%22%23ccc%22 width=%22500%22 height=%22300%22/%3E%3C/svg%3E'">
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
              <div class="bg-purple-50 border border-purple-200 p-3 rounded-2xl">
                🗓 Quincenal<br><span class="font-black text-purple-700">$${p.preciosCuotas?.[12] || 0}</span>
              </div>
              <div class="bg-gray-100 p-3 rounded-2xl">4 cuotas<br><span class="font-black">$${p.preciosCuotas?.[4] || 0}</span></div>
              <div class="bg-gray-100 p-3 rounded-2xl">6 cuotas<br><span class="font-black">$${p.preciosCuotas?.[6] || 0}</span></div>
              <div class="bg-gray-100 p-3 rounded-2xl">8 cuotas<br><span class="font-black">$${p.preciosCuotas?.[8] || 0}</span></div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ===============================
// MODAL PRODUCTO
// ===============================

function abrirFormularioProducto(prod = null) {
  document.getElementById('modalContent').innerHTML = `
    <div class="p-6 max-h-[90vh] overflow-y-auto">
      <h2 class="text-3xl font-black mb-6">${prod ? 'Editar Artículo' : 'Nuevo Artículo'}</h2>

      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Nombre del artículo</label>
        <input id="nombreProd" placeholder="Ej: iPhone 15 Pro" value="${prod?.nombre || ''}"
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-green-500">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Imagen del producto</label>
        <input id="fotoInput" type="file" accept="image/*" class="w-full p-3 border border-gray-300 rounded-xl">
        ${prod?.foto ? `<p class="text-xs text-green-600 mt-2 font-semibold">✓ Imagen guardada en este dispositivo</p>` : ''}
        <p class="text-xs text-gray-400 mt-1">⚠️ Las imágenes se guardan localmente en este dispositivo</p>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-2">Costo</label>
          <input id="costo" type="number" placeholder="$0" value="${prod?.costo || ''}"
            class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-green-500">
        </div>
        <div>
          <label class="block text-sm font-bold text-gray-700 mb-2">Precio contado</label>
          <input id="precioContado" type="number" placeholder="$0" value="${prod?.precioContado || ''}"
            class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-green-500">
        </div>
      </div>

      <div class="mb-6">
        <label class="block text-sm font-bold text-gray-700 mb-3">Precios por cuota</label>
        <div class="grid grid-cols-2 gap-3">

          <div class="bg-purple-50 p-3 rounded-xl border border-purple-200 col-span-2">
            <label class="text-xs text-purple-700 font-semibold block mb-2">🗓 Quincenal (valor por quincena — 2 pagos en total)</label>
            <input id="c12" type="number" placeholder="$0" value="${prod?.preciosCuotas?.[12] || ''}"
              oninput="mostrarTotalCuota(12)"
              class="w-full p-2 border border-purple-300 rounded-lg text-sm focus:outline-none focus:border-purple-500">
            <p id="info12" class="text-xs text-purple-600 mt-1">
              Total (2 quincenas): $${(prod?.preciosCuotas?.[12] || 0) * 2}
            </p>
          </div>

          <div class="bg-gray-50 p-3 rounded-xl border border-gray-200">
            <label class="text-xs text-gray-600 font-semibold block mb-2">4 cuotas</label>
            <input id="c4" type="number" placeholder="$0" value="${prod?.preciosCuotas?.[4] || ''}"
              oninput="mostrarTotalCuota(4)"
              class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-500">
            <p id="info4" class="text-xs text-gray-500 mt-1">Total: $${(prod?.preciosCuotas?.[4] || 0) * 4}</p>
          </div>

          <div class="bg-gray-50 p-3 rounded-xl border border-gray-200">
            <label class="text-xs text-gray-600 font-semibold block mb-2">6 cuotas</label>
            <input id="c6" type="number" placeholder="$0" value="${prod?.preciosCuotas?.[6] || ''}"
              oninput="mostrarTotalCuota(6)"
              class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-500">
            <p id="info6" class="text-xs text-gray-500 mt-1">Total: $${(prod?.preciosCuotas?.[6] || 0) * 6}</p>
          </div>

          <div class="bg-gray-50 p-3 rounded-xl border border-gray-200 col-span-2">
            <label class="text-xs text-gray-600 font-semibold block mb-2">8 cuotas</label>
            <input id="c8" type="number" placeholder="$0" value="${prod?.preciosCuotas?.[8] || ''}"
              oninput="mostrarTotalCuota(8)"
              class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-500">
            <p id="info8" class="text-xs text-gray-500 mt-1">Total: $${(prod?.preciosCuotas?.[8] || 0) * 8}</p>
          </div>

        </div>
      </div>

      <div class="mb-6">
        <label class="block text-sm font-bold text-gray-700 mb-2">Stock disponible</label>
        <input id="stock" type="number" placeholder="0" value="${prod?.stock || 0}"
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-green-500">
      </div>

      <div class="grid grid-cols-2 gap-4 mt-8">
        <button onclick="guardarProducto(${prod ? prod.id : 'null'})" class="bg-green-600 text-white py-3 rounded-2xl font-bold hover:bg-green-700">Guardar</button>
        <button onclick="cerrarModal()" class="bg-gray-200 py-3 rounded-2xl font-bold hover:bg-gray-300">Cancelar</button>
      </div>
    </div>
  `;
  document.getElementById('modal').classList.remove('hidden');
}

function mostrarTotalCuota(c) {
  const valor = Number(document.getElementById(`c${c}`).value) || 0;
  const el = document.getElementById(`info${c}`);
  if (!el) return;
  if (c === 12) {
    el.innerHTML = `Total (2 quincenas): $${(valor * 2).toLocaleString()}`;
  } else {
    el.innerHTML = `Total: $${(valor * c).toLocaleString()}`;
  }
}

function guardarProducto(id) {
  const nombre = document.getElementById('nombreProd').value.trim();
  if (!nombre) return Swal.fire({ icon: 'warning', title: 'Ingrese nombre' });
  const file = document.getElementById('fotoInput').files[0];
  if (file) {
    // Comprimir imagen antes de guardar para no exceder límites
    comprimirImagen(file, 800, 0.75).then(base64 => {
      saveProductoFinal(id, nombre, base64);
    });
  } else {
    saveProductoFinal(id, nombre, null);
  }
}

// ── Comprime imagen a maxWidth px y calidad q (0-1) ─────────────────────────
function comprimirImagen(file, maxWidth, calidad) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', calidad));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function saveProductoFinal(id, nombre, foto) {
  const producto = {
    id: id !== null ? id : Date.now(),
    nombre,
    costo: Number(document.getElementById('costo').value) || 0,
    precioContado: Number(document.getElementById('precioContado').value) || 0,
    stock: Number(document.getElementById('stock').value) || 0,
    preciosCuotas: {
      12: Number(document.getElementById('c12').value) || 0,
      4:  Number(document.getElementById('c4').value)  || 0,
      6:  Number(document.getElementById('c6').value)  || 0,
      8:  Number(document.getElementById('c8').value)  || 0,
    },
    foto: foto || (id !== null ? db.productos.find(p => p.id == id)?.foto : null)
  };

  if (producto.foto && producto.foto.startsWith('data:image')) {
    guardarImagenEnCache(producto.id, producto.foto);
  }

  if (id !== null) {
    const index = db.productos.findIndex(p => p.id == id);
    db.productos[index] = producto;
  } else {
    db.productos.push(producto);
  }

  // Guardar localmente primero (con foto)
  localStorage.setItem('productos', JSON.stringify(db.productos));

  // Luego sincronizar con Firebase (sin fotos)
  saveDB();

  cerrarModal();
  showTab(2);

  Swal.fire({
    icon: 'success', title: '¡Artículo guardado!',
    text: 'Los datos se guardaron correctamente',
    toast: true, position: 'top-end', timer: 2000, showConfirmButton: false
  });
}

function editarProducto(id) { abrirFormularioProducto(db.productos.find(p => p.id == id)); }

function eliminarProducto(id) {
  Swal.fire({ title: '¿Eliminar artículo?', icon: 'warning', showCancelButton: true }).then(r => {
    if (r.isConfirmed) { db.productos = db.productos.filter(p => p.id != id); saveDB(); showTab(2); }
  });
}

// ===============================
// CATALOGO
// ===============================

function catalogoHTML() {
  return `
    <div class="flex items-center justify-between mb-8">
      <div><h1 class="text-3xl font-black">Catálogo</h1><p class="text-gray-500">Vista para clientes</p></div>
      <div class="flex gap-3">
        <button onclick="exportarCatalogoPDF()" class="bg-red-600 text-white px-5 py-3 rounded-2xl font-bold hover:bg-red-700">📄 PDF</button>
        <button onclick="compartirPorWhatsApp()" class="bg-green-600 text-white px-5 py-3 rounded-2xl font-bold hover:bg-green-700">💬 WhatsApp</button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
      ${db.productos.map(p => `
        <div class="bg-white rounded-3xl overflow-hidden shadow-xl">
          <div class="w-full h-64 bg-gray-300 relative overflow-hidden">
            <img src="${p.foto || 'https://picsum.photos/500/300'}" loading="lazy" class="w-full h-64 object-cover"
              onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22500%22 height=%22400%22%3E%3Crect fill=%22%23ccc%22 width=%22500%22 height=%22400%22/%3E%3C/svg%3E'">
          </div>
          <div class="p-5">
            <h2 class="text-2xl font-black">${p.nombre}</h2>
            <p class="text-4xl font-black text-green-600 mt-4">$${p.precioContado}</p>
            <p class="text-gray-500">Contado</p>
            <div class="grid grid-cols-2 gap-3 mt-5">
              <div class="bg-purple-50 rounded-2xl p-3 border border-purple-200">
                <p class="text-xs text-purple-600 font-bold">🗓 Quincenal</p>
                <p class="font-black text-lg text-purple-700">$${p.preciosCuotas?.[12] || 0}</p>
              </div>
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
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ===============================
// EXPORTAR PDF CATALOGO
// ===============================

async function exportarCatalogoPDF() {
  if (!db.productos || db.productos.length === 0) {
    return Swal.fire({ icon: 'warning', title: 'No hay productos', text: 'Agrega artículos primero' });
  }

  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  script.onerror = () => { Swal.fire({ icon: 'error', title: 'Error al cargar la librería', text: 'Verificá tu conexión a internet' }); };
  script.onload = function () {
    let html = `
      <div style="font-family: Arial, sans-serif; padding: 15px;">
        <h1 style="text-align: center; color: #1f2937; margin-bottom: 5px; font-size: 24px;">CATALOGO DE PRODUCTOS</h1>
        <p style="text-align: center; color: #6b7280; margin-bottom: 20px; font-size: 11px;">${new Date().toLocaleDateString('es-AR')}</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
    `;

    db.productos.forEach(p => {
      html += `
        <div style="border: 1px solid #d1d5db; border-radius: 6px; padding: 10px; page-break-inside: avoid;">
          <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <img src="${p.foto || 'https://picsum.photos/300/300'}"
              style="width: 110px; height: 110px; object-fit: cover; border-radius: 4px; flex-shrink: 0;">
            <div style="flex: 1; display: flex; flex-direction: column;">
              <h3 style="margin: 0 0 5px 0; color: #1f2937; font-size: 13px; font-weight: bold;">${p.nombre}</h3>
              <div style="background: #fef3c7; padding: 6px; border-radius: 3px; margin-bottom: 6px;">
                <p style="margin: 0; color: #16a34a; font-size: 14px; font-weight: bold;">$${p.precioContado.toLocaleString()}</p>
                <p style="margin: 0; color: #6b7280; font-size: 10px;">Contado</p>
              </div>
              <div style="background: #f5f3ff; padding: 5px; border-radius: 3px; margin-bottom: 5px; border-left: 3px solid #7c3aed;">
                <p style="margin: 0; color: #6d28d9; font-size: 11px; font-weight: bold;">🗓 Quincenal: $${p.preciosCuotas?.[12] || 0}</p>
              </div>
              <p style="margin: 0; color: #6b7280; font-size: 10px; font-weight: bold;">Cuotas:</p>
              <div style="font-size: 9px; color: #374151; line-height: 1.4;">
                <p style="margin: 2px 0;">4x $${p.preciosCuotas?.[4] || 0}</p>
                <p style="margin: 2px 0;">6x $${p.preciosCuotas?.[6] || 0}</p>
                <p style="margin: 2px 0;">8x $${p.preciosCuotas?.[8] || 0}</p>
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
    html2pdf().set({
      margin: 8, filename: 'Catalogo-Productos.pdf',
      image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 },
      jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' }
    }).from(element).save();

    Swal.fire({ icon: 'success', title: 'PDF generado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
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

        <select id="cuotasSelect" onchange="calcularTotal()" class="w-full p-4 border rounded-2xl mb-4">
          <option value="1">Contado</option>
          <option value="12">🗓 Quincenal</option>
          <option value="4">4 cuotas</option>
          <option value="6">6 cuotas</option>
          <option value="8">8 cuotas</option>
        </select>

        <div class="mb-4">
          <label class="font-bold text-gray-700 block mb-2">Entrega inicial</label>
          <input id="entregaInput" type="number" min="0" value="0" oninput="calcularTotal()" placeholder="0" class="w-full p-4 border rounded-2xl">
        </div>

        <div class="bg-gray-100 rounded-3xl p-5 mt-6 space-y-4">
          <div class="flex justify-between">
            <span class="text-gray-500">Total productos</span>
            <span id="totalProductos" class="font-black">$0</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Entrega</span>
            <span id="entregaMostrada" class="font-black text-blue-600">$0</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500">Saldo restante</span>
            <span id="saldoRestante" class="font-black text-red-600">$0</span>
          </div>
          <div class="flex justify-between border-t pt-4">
            <span class="text-gray-700 font-bold" id="labelPagoCuota">Pago por cuota</span>
            <span id="valorCuota" class="font-black text-green-600 text-xl">$0</span>
          </div>
        </div>

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
  if (!id) return;
  const producto = db.productos.find(p => p.id == id);
  const existe = carrito.find(i => i.id == id);
  if (existe) { existe.cantidad++; } else { carrito.push({ ...producto, cantidad: 1 }); }
  actualizarCarrito();
  document.getElementById('productoSelect').value = '';
}

function actualizarCarrito() {
  const container = document.getElementById('carritoLista');
  if (!container) return;
  if (carrito.length === 0) {
    container.innerHTML = `<div class="text-center py-10 text-gray-400">Carrito vacío</div>`;
    calcularTotal(); return;
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

function sumarCantidad(index) { carrito[index].cantidad++; actualizarCarrito(); }
function restarCantidad(index) {
  carrito[index].cantidad--;
  if (carrito[index].cantidad <= 0) carrito.splice(index, 1);
  actualizarCarrito();
}

function calcularTotal() {
  const cuotas = Number(document.getElementById('cuotasSelect')?.value || 1);
  const entrega = Number(document.getElementById('entregaInput')?.value || 0);
  const esQuincenal = cuotas === 12;
  let total = 0;

  carrito.forEach(item => {
    let precio = 0;
    if (cuotas === 1) {
      precio = item.precioContado;
    } else if (esQuincenal) {
      precio = (item.preciosCuotas?.[12] || 0) * 2;
    } else {
      precio = (item.preciosCuotas?.[cuotas] || 0) * cuotas;
    }
    total += precio * item.cantidad;
  });

  const cuotasTotalesReales = esQuincenal ? 2 : cuotas;
  const saldoRestante = Math.max(0, total - entrega);
  const valorCuota = cuotasTotalesReales > 1 ? Math.ceil(saldoRestante / cuotasTotalesReales) : saldoRestante;

  const labelEl = document.getElementById('labelPagoCuota');
  if (labelEl) {
    labelEl.textContent = esQuincenal ? 'Pago por quincena' : cuotas == 1 ? 'Pago único' : 'Pago por cuota';
  }

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  setEl('totalFinal', '$' + total.toLocaleString());
  setEl('totalProductos', '$' + total.toLocaleString());
  setEl('entregaMostrada', '$' + entrega.toLocaleString());
  setEl('saldoRestante', '$' + saldoRestante.toLocaleString());
  setEl('valorCuota', cuotas === 1 ? '$' + saldoRestante.toLocaleString() : '$' + valorCuota.toLocaleString());
}

function finalizarVenta() {
  if (carrito.length === 0) return Swal.fire({ icon: 'warning', title: 'Carrito vacío' });
  const clienteId = document.getElementById('clienteSelect').value;
  if (!clienteId) return Swal.fire({ icon: 'warning', title: 'Selecciona un cliente' });

  const cliente = db.clientes.find(c => c.id == clienteId);
  const cuotasSelect = parseInt(document.getElementById('cuotasSelect').value);
  const entrega = Number(document.getElementById('entregaInput').value || 0);
  const esQuincenal = cuotasSelect === 12;

  const cuotasTotalesReales = esQuincenal ? 2 : cuotasSelect;

  let total = 0;
  const itemsVenta = [];

  carrito.forEach(item => {
    let precioUnitario, subtotal;
    if (cuotasSelect === 1) {
      precioUnitario = item.precioContado;
      subtotal = precioUnitario * item.cantidad;
    } else if (esQuincenal) {
      precioUnitario = item.preciosCuotas?.[12] || item.precioContado;
      subtotal = precioUnitario * 2 * item.cantidad;
    } else {
      precioUnitario = item.preciosCuotas?.[cuotasSelect] || item.precioContado;
      subtotal = precioUnitario * cuotasSelect * item.cantidad;
    }
    total += subtotal;
    itemsVenta.push({ id: item.id, nombre: item.nombre, cantidad: item.cantidad, precio: precioUnitario, subtotal });
  });

  const saldoRestante = Math.max(0, total - entrega);
  const valorCuota = cuotasTotalesReales > 1 ? Math.ceil(saldoRestante / cuotasTotalesReales) : saldoRestante;

  db.ventaCounter++;
  const venta = {
    id: db.ventaCounter,
    fecha: new Date().toLocaleDateString('es-AR'),
    clienteNombre: cliente.nombre,
    items: itemsVenta, total, entrega,
    saldoOriginal: saldoRestante, valorCuota,
    cuotasTotales: cuotasTotalesReales,
    cuotasPagadas: cuotasSelect === 1 ? 1 : 0,
    saldo: saldoRestante, pagado: entrega,
    esQuincenal, historialPagos: []
  };

  db.ventas.push(venta);
  carrito.forEach(item => {
    const prod = db.productos.find(p => p.id === item.id);
    if (prod) prod.stock -= item.cantidad;
  });
  cliente.compras = (cliente.compras || 0) + total;
  saveDB();
  carrito = [];

  const labelCuota = esQuincenal ? 'Quincenal' : `${cuotasTotalesReales} cuotas de`;
  Swal.fire({
    icon: 'success', title: 'Venta registrada correctamente',
    html: `<div style="text-align:left">
      <p><b>Total:</b> $${total.toLocaleString()}</p>
      <p><b>Entrega:</b> $${entrega.toLocaleString()}</p>
      <p><b>Saldo:</b> $${saldoRestante.toLocaleString()}</p>
      <p><b>${labelCuota}:</b> $${valorCuota.toLocaleString()}</p>
    </div>`
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
      <div><h2 class="text-3xl font-bold">Pagos Pendientes</h2><p class="text-gray-500 text-sm mt-1">Clientes con cuotas activas</p></div>
    </div>

    <div class="bg-gradient-to-r from-red-600 to-red-500 text-white p-6 rounded-3xl shadow-xl mb-8">
      <div class="flex items-center justify-between">
        <div><p class="text-red-100">Total a Cobrar</p><h2 class="text-4xl font-black mt-2">$${totalPendiente.toLocaleString()}</h2></div>
        <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl">💰</div>
      </div>
    </div>

    <div class="space-y-5">
      ${pendientes.map(v => {
        const esQuincenal = v.esQuincenal || v.cuotasTotales === 12;
        const labelCuota = esQuincenal ? '🗓 Quincenal' : 'Cuota';
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
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="text-xs font-black text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-lg">#${fmtId(v.id)}</span>
                  <h3 class="font-bold text-lg">${v.clienteNombre}</h3>
                </div>
                <div class="mt-2 flex flex-wrap gap-2">
                  <span class="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">Total: $${v.total.toLocaleString()}</span>
                  <span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">Entrega: $${(v.entrega || 0).toLocaleString()}</span>
                  <span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-bold">${labelCuota}: $${(v.valorCuota || 0).toLocaleString()}</span>
                </div>
                <div class="mt-3 bg-gray-50 rounded-2xl p-3">${productos}</div>
              </div>
              <div class="text-right">
                <p class="text-red-600 text-2xl font-bold">$${v.saldo.toLocaleString()}</p>
                <p class="text-sm text-gray-500 mt-1">
                  ${esQuincenal
                    ? `${v.cuotasPagadas}/${v.cuotasTotales} quincenas`
                    : `${v.cuotasPagadas}/${v.cuotasTotales} cuotas`}
                </p>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
              <button onclick="registrarPago(${v.id})" class="bg-green-600 hover:bg-green-700 text-white py-4 rounded-2xl font-semibold transition">💵 Registrar Pago</button>
              <button onclick="cancelarUltimoPago(${v.id})" class="bg-yellow-500 hover:bg-yellow-600 text-white py-4 rounded-2xl font-semibold transition">↩️ Cancelar Último Pago</button>
              <button onclick="eliminarVentaPendiente(${v.id})" class="bg-red-600 hover:bg-red-700 text-white py-4 rounded-2xl font-semibold transition">🗑️ Eliminar Venta</button>
            </div>
            ${(() => {
              let pagos = [];
              if (v.entrega > 0) pagos.push({ monto: v.entrega, fecha: v.fecha });
              if (v.historialPagos?.length) {
                v.historialPagos.forEach(p => {
                  if (!pagos.find(x => x.monto === p.monto && x.fecha === p.fecha)) pagos.push(p);
                });
              } else if (!pagos.length && v.pagado > 0) {
                pagos.push({ monto: v.pagado, fecha: v.fecha });
              } else if (!pagos.length) {
                pagos.push({ monto: v.total, fecha: v.fecha });
              }
              const fmtFecha = f => {
                if (!f) return '';
                if (typeof f === 'string' && f.includes('/')) return f;
                const d = new Date(f);
                return isNaN(d) ? String(f) : d.toLocaleDateString('es-AR');
              };
              return `
              <div class="mt-4 pt-4 border-t border-gray-100">
                <p class="text-xs font-bold text-gray-500 mb-2">COMPROBANTES</p>
                ${pagos.map(p => `
                  <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <span class="text-sm font-semibold text-gray-700">$${p.monto.toLocaleString()}</span>
                      ${fmtFecha(p.fecha) ? `<span class="text-xs text-gray-400 ml-2">${fmtFecha(p.fecha)}</span>` : ''}
                    </div>
                    <div class="flex gap-2">
                      <button onclick="descargarComprobantePago(${v.id}, ${p.monto})"
                        class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1 rounded-lg font-semibold transition">
                        📄 PDF
                      </button>
                      <button onclick="wspComprobantePago(${v.id}, ${p.monto})"
                        class="text-xs bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1 rounded-lg font-semibold transition">
                        📲 WS
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>`;
            })()}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function registrarPago(id) {
  const venta = db.ventas.find(v => v.id == id);
  const esQuincenal = venta.esQuincenal || false;
  const cuotasPendientes = Math.max(1, venta.cuotasTotales - venta.cuotasPagadas);
  const montoSugerido = venta.valorCuota || Math.round(venta.saldo / cuotasPendientes);

  Swal.fire({
    title: esQuincenal ? '💵 Registrar pago quincenal' : '💵 Registrar pago',
    html: `
      <div style="text-align:left; padding: 0 8px;">
        <p style="margin-bottom:6px; color:#6b7280; font-size:13px;">
          ${esQuincenal ? 'Quincenas pagadas: <b>' + venta.cuotasPagadas + '</b>' : 'Cuotas: <b>' + venta.cuotasPagadas + '/' + venta.cuotasTotales + '</b>'}
        </p>
        <p style="margin-bottom:4px; color:#6b7280; font-size:13px;">
          Saldo actual: <b style="color:#ef4444;">$${venta.saldo.toLocaleString()}</b>
        </p>
        <p style="margin-bottom:12px; color:#6b7280; font-size:13px;">
          Monto sugerido: <b style="color:#16a34a;">$${montoSugerido.toLocaleString()}</b>
        </p>
        <label style="font-size:13px; font-weight:600; color:#374151; display:block; margin-bottom:6px;">
          Monto a registrar:
        </label>
        <input
          id="montoPagoInput"
          type="number"
          min="1"
          step="1"
          value="${montoSugerido}"
          class="swal2-input"
          style="margin:0; width:100%;"
          placeholder="Ingresá el monto"
        >
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '✅ Confirmar pago',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a',
    didOpen: () => {
      const input = document.getElementById('montoPagoInput');
      if (input) { input.focus(); input.select(); }
    },
    preConfirm: () => {
      const input = document.getElementById('montoPagoInput');
      const montoIngresado = Number(input ? input.value : 0);
      if (!montoIngresado || montoIngresado <= 0) {
        Swal.showValidationMessage('Ingresá un monto válido mayor a $0');
        return false;
      }
      if (montoIngresado > venta.saldo) {
        Swal.showValidationMessage(`El monto no puede superar el saldo ($${venta.saldo.toLocaleString()})`);
        return false;
      }
      return montoIngresado;
    }
  }).then(r => {
    if (!r.isConfirmed) return;

    const montoPagado = r.value;
    venta.saldo = Math.max(0, venta.saldo - montoPagado);
    venta.pagado = (venta.pagado || 0) + montoPagado;
    venta.historialPagos = venta.historialPagos || [];
    venta.historialPagos.push({ fecha: new Date().toISOString(), monto: montoPagado });
    venta.cuotasPagadas = venta.cuotasTotales > 1 ? venta.historialPagos.length : 1;
    saveDB();

    mostrarModalPostPago(venta, montoPagado);
  });
}

function mostrarModalPostPago(venta, montoPagado) {
  const cliente = db.clientes.find(c => c.nombre === venta.clienteNombre);
  const esQuincenal = venta.esQuincenal || false;
  const terminada = venta.saldo === 0;

  document.getElementById('modalContent').innerHTML = `
    <div class="p-6">
      <div style="text-align:center; margin-bottom:20px;">
        <div style="font-size:48px; margin-bottom:8px;">✅</div>
        <h2 style="font-size:22px; font-weight:900; color:#1f2937; margin-bottom:4px;">Pago registrado</h2>
        <p style="color:#6b7280; font-size:13px;">
          ${esQuincenal
            ? `Quincena ${venta.cuotasPagadas} de ${venta.cuotasTotales}`
            : venta.cuotasTotales === 1 ? 'Pago contado' : `Cuota ${venta.cuotasPagadas} de ${venta.cuotasTotales}`}
        </p>
      </div>

      <div style="background:#f9fafb; border-radius:12px; padding:14px; margin-bottom:18px;">
        <div style="display:flex; justify-content:space-between; padding:5px 0; font-size:14px;">
          <span style="color:#6b7280;">Cliente</span>
          <strong>${venta.clienteNombre}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:5px 0; font-size:14px;">
          <span style="color:#6b7280;">Monto pagado</span>
          <strong style="color:#16a34a; font-size:18px;">$${montoPagado.toLocaleString()}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding:5px 0; font-size:14px; border-top:1px solid #e5e7eb; margin-top:6px; padding-top:10px;">
          <span style="color:#6b7280;">Saldo restante</span>
          <strong style="color:${terminada ? '#16a34a' : '#ef4444'};">
            ${terminada ? '✓ Pagado completo' : '$' + venta.saldo.toLocaleString()}
          </strong>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button onclick="descargarComprobanteUnico(${venta.id}, ${montoPagado})"
          style="background:#f3f4f6; border:1.5px solid #d1d5db; border-radius:12px; padding:13px; font-size:14px; font-weight:700; cursor:pointer; color:#374151; display:flex; align-items:center; justify-content:center; gap:8px;">
          📄 Descargar comprobante PDF
        </button>

        ${cliente?.telefono ? `
        <button onclick="wspComprobanteUnico(${venta.id}, ${montoPagado})"
          style="background:#dcfce7; border:1.5px solid #86efac; border-radius:12px; padding:13px; font-size:14px; font-weight:700; cursor:pointer; color:#166534; display:flex; align-items:center; justify-content:center; gap:8px;">
          📲 Enviar por WhatsApp
        </button>
        ` : `
        <div style="background:#fef9c3; border:1px solid #fde047; border-radius:10px; padding:10px; font-size:12px; color:#854d0e; text-align:center;">
          ⚠️ El cliente no tiene teléfono registrado
        </div>
        `}

        <button onclick="cerrarModal(); showTab(5);"
          style="background:none; border:none; color:#9ca3af; font-size:13px; cursor:pointer; padding:8px;">
          Cerrar
        </button>
      </div>
    </div>
  `;
  document.getElementById('modal').classList.remove('hidden');
}

function cancelarUltimoPago(id) {
  const venta = db.ventas.find(v => v.id == id);
  if (!venta.historialPagos || venta.historialPagos.length === 0) {
    return Swal.fire({ icon: 'warning', title: 'No hay pagos registrados' });
  }
  const ultimoPago = venta.historialPagos[venta.historialPagos.length - 1];
  Swal.fire({
    title: '¿Cancelar último pago?',
    html: `<p>Se devolverán <b>$${ultimoPago.monto.toLocaleString()}</b></p>`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, cancelar', cancelButtonText: 'No'
  }).then(r => {
    if (r.isConfirmed) {
      venta.saldo += ultimoPago.monto;
      venta.pagado -= ultimoPago.monto;
      venta.historialPagos.pop();
      venta.cuotasPagadas = venta.cuotasTotales > 1 ? venta.historialPagos.length : 0;
      saveDB();
      Swal.fire({ icon: 'success', title: 'Pago cancelado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
      showTab(5);
    }
  });
}

function eliminarVentaPendiente(id) {
  Swal.fire({
    title: '¿Eliminar venta?',
    html: `<p>Se restaurará el stock y se borrarán todos los pagos.</p>`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444'
  }).then(r => {
    if (r.isConfirmed) {
      const venta = db.ventas.find(v => v.id == id);
      if (!venta) return;
      venta.items.forEach(item => {
        const producto = db.productos.find(p => p.id == item.id) || db.productos.find(p => p.nombre === item.nombre);
        if (producto) producto.stock += item.cantidad;
      });
      const cliente = db.clientes.find(c => c.nombre === venta.clienteNombre);
      if (cliente) { cliente.compras = Math.max(0, (cliente.compras || 0) - venta.total); }
      db.ventas = db.ventas.filter(v => v.id != id);
      saveDB();
      Swal.fire({ icon: 'success', title: 'Venta eliminada', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
      showTab(5);
    }
  });
}

// ===============================
// COMPROBANTE PDF
// ===============================

function buildComprobanteHTML(venta, monto) {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-AR');
  const hora  = ahora.toLocaleTimeString('es-AR');
  const esQuincenal = venta.esQuincenal || false;

  let cuotasInfo = '';
  if (venta.cuotasTotales === 1) {
    cuotasInfo = '<p style="margin:6px 0"><strong>PAGO ÚNICO - CONTADO</strong></p>';
  } else if (esQuincenal) {
    cuotasInfo = `
      <p style="margin:6px 0"><strong>PLAN QUINCENAL</strong></p>
      <p style="margin:6px 0">Quincenas pagadas: <strong>${venta.cuotasPagadas} de ${venta.cuotasTotales}</strong></p>
      <p style="margin:6px 0;color:#dc2626">Monto restante: <strong>$${venta.saldo.toLocaleString()}</strong></p>`;
  } else {
    cuotasInfo = `
      <p style="margin:6px 0">Cuota: <strong>${venta.cuotasPagadas} de ${venta.cuotasTotales}</strong></p>
      <p style="margin:6px 0">Cuotas restantes: <strong>${venta.cuotasTotales - venta.cuotasPagadas}</strong></p>
      <p style="margin:6px 0;color:#dc2626">Monto restante: <strong>$${venta.saldo.toLocaleString()}</strong></p>`;
  }

  let itemsRows = '';
  venta.items.forEach(item => {
    itemsRows += `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${item.nombre}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.cantidad}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">$${item.precio.toLocaleString()}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;">$${item.subtotal.toLocaleString()}</td>
    </tr>`;
  });

  return `<div style="font-family:Arial,Helvetica,sans-serif;width:520px;padding:32px;background:#fff;color:#1f2937;">
  <div style="text-align:center;padding-bottom:16px;border-bottom:3px solid #7c3aed;margin-bottom:20px;">
    <h1 style="margin:0;font-size:22px;color:#7c3aed;letter-spacing:1px;">COMPROBANTE DE PAGO</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">OneShop</p>
  </div>
  <table style="width:100%;margin-bottom:16px;">
    <tr><td style="font-size:13px;color:#6b7280;">Fecha:</td><td style="font-size:13px;font-weight:bold;text-align:right;">${fecha}</td></tr>
    <tr><td style="font-size:13px;color:#6b7280;">Hora:</td><td style="font-size:13px;text-align:right;">${hora}</td></tr>
    <tr><td style="font-size:13px;color:#6b7280;">Cliente:</td><td style="font-size:13px;font-weight:bold;text-align:right;">${venta.clienteNombre}</td></tr>
    <tr><td style="font-size:13px;color:#6b7280;">N° Venta:</td><td style="font-size:13px;text-align:right;">#${fmtId(venta.id)}</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <thead><tr style="background:#f3f4f6;">
      <th style="padding:6px 8px;text-align:left;font-size:12px;color:#374151;border-bottom:2px solid #d1d5db;">Artículo</th>
      <th style="padding:6px 8px;text-align:center;font-size:12px;color:#374151;border-bottom:2px solid #d1d5db;">Cant.</th>
      <th style="padding:6px 8px;text-align:right;font-size:12px;color:#374151;border-bottom:2px solid #d1d5db;">Precio</th>
      <th style="padding:6px 8px;text-align:right;font-size:12px;color:#374151;border-bottom:2px solid #d1d5db;">Subtotal</th>
    </tr></thead>
    <tbody style="font-size:12px;">${itemsRows}</tbody>
  </table>
  <div style="background:#f5f3ff;border-left:4px solid #7c3aed;padding:12px 14px;margin-bottom:14px;border-radius:0 6px 6px 0;">
    <p style="margin:0;font-size:12px;color:#6b7280;">Monto pagado en esta transacción</p>
    <p style="margin:4px 0 0;font-size:24px;font-weight:900;color:#16a34a;">$${monto.toLocaleString()}</p>
  </div>
  <div style="background:#f9fafb;padding:12px 14px;border-radius:6px;margin-bottom:16px;font-size:12px;">
    <p style="margin:0 0 6px;font-weight:bold;color:#374151;">ESTADO DE PAGOS</p>
    ${cuotasInfo}
  </div>
  <div style="text-align:center;padding-top:16px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:14px;font-weight:bold;color:#7c3aed;">¡Muchas gracias por tu compra!</p>
    <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Este comprobante es válido como recibo de pago</p>
  </div>
</div>`;
}

function descargarPDFComprobante(venta, monto) {
  const cargarLib = () => new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('Timeout cargando jsPDF')), 8000);
  });

  cargarLib().then(() => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const esQuincenal = venta.esQuincenal || false;
    const W = 210;
    const margen = 20;
    const ancho = W - margen * 2;
    let y = 20;

    const colorVioleta  = [124, 58, 237];
    const colorGris     = [107, 114, 128];
    const colorNegro    = [31, 41, 55];
    const colorVerde    = [22, 163, 74];
    const colorRojo     = [220, 38, 38];
    const colorFondoGris  = [243, 244, 246];
    const colorFondoViola = [245, 243, 255];

    doc.setFillColor(...colorVioleta);
    doc.rect(margen, y, ancho, 0.8, 'F');
    y += 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...colorVioleta);
    doc.text('COMPROBANTE DE PAGO', W / 2, y + 6, { align: 'center' });
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...colorGris);
    doc.text('OneShop', W / 2, y + 4, { align: 'center' });
    y += 10;

    doc.setFillColor(...colorVioleta);
    doc.rect(margen, y, ancho, 0.4, 'F');
    y += 8;

    const now = new Date();
    const fecha = now.toLocaleDateString('es-AR');
    const hora  = now.toLocaleTimeString('es-AR');

    const col1 = margen;
    const col2 = margen + ancho / 2;

    doc.setFontSize(9);
    doc.setTextColor(...colorGris);
    doc.text('Fecha:', col1, y);
    doc.setTextColor(...colorNegro);
    doc.setFont('helvetica', 'bold');
    doc.text(fecha, col1 + 20, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colorGris);
    doc.text('Hora:', col2, y);
    doc.setTextColor(...colorNegro);
    doc.setFont('helvetica', 'bold');
    doc.text(hora, col2 + 14, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colorGris);
    doc.text('Cliente:', col1, y);
    doc.setTextColor(...colorNegro);
    doc.setFont('helvetica', 'bold');
    doc.text(venta.clienteNombre, col1 + 20, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colorGris);
    doc.text('N° Venta:', col2, y);
    doc.setTextColor(...colorNegro);
    doc.setFont('helvetica', 'bold');
    doc.text('#' + fmtId(venta.id), col2 + 22, y);
    y += 10;

    doc.setFillColor(...colorFondoGris);
    doc.rect(margen, y - 4, ancho, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...colorNegro);
    doc.text('Artículo', col1 + 2, y);
    doc.text('Cant.', margen + ancho * 0.60, y, { align: 'center' });
    doc.text('Precio', margen + ancho * 0.78, y, { align: 'right' });
    doc.text('Subtotal', margen + ancho, y, { align: 'right' });
    y += 5;

    doc.setDrawColor(209, 213, 219);
    doc.line(margen, y, margen + ancho, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    venta.items.forEach((item, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(249, 250, 251);
        doc.rect(margen, y - 4, ancho, 7, 'F');
      }
      doc.setTextColor(...colorNegro);
      const nombreCorto = item.nombre.length > 38 ? item.nombre.substring(0, 36) + '…' : item.nombre;
      doc.text(nombreCorto, col1 + 2, y);
      doc.text(String(item.cantidad), margen + ancho * 0.60, y, { align: 'center' });
      doc.text('$' + item.precio.toLocaleString(), margen + ancho * 0.78, y, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text('$' + item.subtotal.toLocaleString(), margen + ancho, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 7;
    });

    doc.setDrawColor(209, 213, 219);
    doc.line(margen, y, margen + ancho, y);
    y += 8;

    doc.setFillColor(...colorFondoViola);
    doc.rect(margen, y - 4, ancho, 18, 'F');
    doc.setFillColor(...colorVioleta);
    doc.rect(margen, y - 4, 1.5, 18, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...colorGris);
    doc.text('Monto pagado en esta transacción:', col1 + 4, y + 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...colorVerde);
    doc.text('$' + monto.toLocaleString(), col1 + 4, y + 12);
    y += 24;

    doc.setFillColor(...colorFondoGris);
    doc.rect(margen, y - 4, ancho, venta.cuotasTotales === 1 ? 10 : 22, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...colorNegro);
    doc.text('ESTADO DE PAGOS', col1 + 2, y + 2);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    if (venta.cuotasTotales === 1) {
      doc.setTextColor(...colorVerde);
      doc.setFont('helvetica', 'bold');
      doc.text('PAGO ÚNICO — CONTADO', col1 + 2, y);
    } else if (esQuincenal) {
      doc.setTextColor(...colorNegro);
      doc.text('Plan Quincenal', col1 + 2, y);
      doc.text(`Quincenas pagadas: ${venta.cuotasPagadas} de ${venta.cuotasTotales}`, col1 + 2, y + 6);
      if (venta.saldo > 0) {
        doc.setTextColor(...colorRojo);
        doc.text(`Monto restante: $${venta.saldo.toLocaleString()}`, col1 + 2, y + 12);
      }
    } else {
      doc.setTextColor(...colorNegro);
      doc.text(`Cuota ${venta.cuotasPagadas} de ${venta.cuotasTotales}`, col1 + 2, y);
      doc.text(`Cuotas restantes: ${venta.cuotasTotales - venta.cuotasPagadas}`, col1 + 2, y + 6);
      if (venta.saldo > 0) {
        doc.setTextColor(...colorRojo);
        doc.text(`Monto restante: $${venta.saldo.toLocaleString()}`, col1 + 2, y + 12);
      }
    }
    y += venta.cuotasTotales === 1 ? 10 : 20;

    doc.setDrawColor(229, 231, 235);
    doc.line(margen, y, margen + ancho, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...colorVioleta);
    doc.text('¡Muchas gracias por tu compra!', W / 2, y, { align: 'center' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...colorGris);
    doc.text('Este comprobante es válido como recibo de pago', W / 2, y, { align: 'center' });

    const nombreArchivo = `Comprobante-${fmtId(venta.id)}-${venta.clienteNombre.replace(/\s+/g, '-')}.pdf`;
    doc.save(nombreArchivo);
  }).catch(e => {
    console.error('Error generando PDF:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo generar el PDF. Verificá tu conexión.' });
  });
}

window.descargarComprobanteUnico = function(ventaId, monto) {
  const venta = db.ventas.find(v => v.id == ventaId);
  if (!venta) return;
  descargarPDFComprobante(venta, monto);
};

window.wspComprobanteUnico = function(ventaId, monto) {
  const venta = db.ventas.find(v => v.id == ventaId);
  const cliente = db.clientes.find(c => c.nombre === venta?.clienteNombre);
  if (!venta || !cliente?.telefono) {
    Swal.fire({ icon: 'warning', title: 'Sin teléfono', text: 'El cliente no tiene número registrado.', confirmButtonText: 'Entendido' });
    return;
  }
  const numeroWhatsApp = normalizarNumeroWhatsApp(cliente.telefono);
  if (!numeroWhatsApp) {
    Swal.fire({ icon: 'error', title: 'Número inválido', text: 'El número del cliente no tiene el formato correcto.', confirmButtonText: 'Entendido' });
    return;
  }
  const msg = `Hola ${cliente.nombre}, te envío el comprobante de pago de $${monto.toLocaleString()}. ¡Gracias!`;
  window.open(`https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(msg)}`, '_blank');
};

function generarComprobantesPago(venta, monto) {
  descargarPDFComprobante(venta, monto);
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
        const esQuincenal = v.esQuincenal || v.cuotasTotales === 12;
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
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-black text-purple-600 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-lg">#${fmtId(v.id)}</span>
                  <h3 class="font-bold text-lg text-gray-800">${v.clienteNombre}</h3>
                  <span class="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">✓ Pagada</span>
                  ${esQuincenal ? '<span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs font-bold">🗓 Quincenal</span>' : ''}
                </div>
                <p class="text-gray-500 text-sm mt-1">Fecha: ${v.fecha}</p>
                <div class="mt-3 bg-green-50 rounded-2xl p-3">${productos}</div>
              </div>
              <div class="text-right">
                <p class="text-green-600 text-2xl font-bold">$${v.total.toLocaleString()}</p>
                <p class="text-sm text-gray-500 mt-1">
                  ${esQuincenal ? '🗓 Quincenal' : v.cuotasTotales === 1 ? 'Contado' : v.cuotasTotales + ' cuotas'}
                </p>
              </div>
            </div>
            <div class="flex gap-2 mt-4 pt-4 border-t border-green-200 flex-wrap">
              <button onclick="descargarComprobanteCompleto(${v.id})" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-2xl font-semibold text-sm">📄 Descargar PDF</button>
              <button onclick="wspComprobanteCompleto(${v.id})" class="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-2xl font-semibold text-sm">📲 WhatsApp</button>
              <button onclick="borrarPago(${v.id})" class="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-2xl font-semibold text-sm">🗑️ Borrar</button>
            </div>
            ${(() => {
              let pagos = [];
              if (v.entrega > 0) pagos.push({ monto: v.entrega, fecha: v.fecha });
              if (v.historialPagos?.length) {
                v.historialPagos.forEach(p => {
                  if (!pagos.find(x => x.monto === p.monto && x.fecha === p.fecha)) pagos.push(p);
                });
              } else if (!pagos.length && v.pagado > 0) {
                pagos.push({ monto: v.pagado, fecha: v.fecha });
              } else if (!pagos.length) {
                pagos.push({ monto: v.total, fecha: v.fecha });
              }
              const fmtFecha = f => {
                if (!f) return '';
                if (typeof f === 'string' && f.includes('/')) return f;
                const d = new Date(f); return isNaN(d) ? String(f) : d.toLocaleDateString('es-AR');
              };
              return `
              <div class="mt-4 pt-4 border-t border-green-100">
                <p class="text-xs font-bold text-gray-500 mb-2">COMPROBANTES</p>
                ${pagos.map(p => `
                  <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <span class="text-sm font-semibold text-gray-700">$${p.monto.toLocaleString()}</span>
                      ${fmtFecha(p.fecha) ? `<span class="text-xs text-gray-400 ml-2">${fmtFecha(p.fecha)}</span>` : ''}
                    </div>
                    <div class="flex gap-2">
                      <button onclick="descargarComprobantePago(${v.id}, ${p.monto})"
                        class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1 rounded-lg font-semibold transition">
                        📄 PDF
                      </button>
                      <button onclick="wspComprobantePago(${v.id}, ${p.monto})"
                        class="text-xs bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1 rounded-lg font-semibold transition">
                        📲 WS
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>`;
            })()}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ===============================
// PEDIDOS
// ===============================

function pedidosHTML() {
  const pendientes = db.pedidos.filter(p => p.estado === 'pendiente');
  const recibidos  = db.pedidos.filter(p => p.estado === 'recibido');

  return `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-3xl font-black text-gray-800">Pedidos</h1>
        <p class="text-gray-500">Registrá lo que necesitás reponer</p>
      </div>
      <div class="flex gap-3 flex-wrap">
        <button onclick="wspListaPedidos()"
          class="bg-green-600 hover:bg-green-700 text-white px-5 py-3 rounded-2xl font-bold shadow-lg flex items-center gap-2">
          📲 Enviar lista por WhatsApp
        </button>
        <button onclick="abrirFormularioPedido()"
          class="bg-amber-500 hover:bg-amber-600 text-white px-5 py-3 rounded-2xl font-bold shadow-lg flex items-center gap-2">
          + Nuevo Pedido
        </button>
      </div>
    </div>

    <!-- Resumen -->
    <div class="grid grid-cols-2 gap-4 mb-8">
      <div class="bg-gradient-to-r from-amber-500 to-orange-400 text-white p-5 rounded-3xl shadow-xl">
        <p class="text-amber-100 text-sm">Pedidos pendientes</p>
        <h2 class="text-4xl font-black mt-1">${pendientes.length}</h2>
      </div>
      <div class="bg-gradient-to-r from-green-600 to-emerald-500 text-white p-5 rounded-3xl shadow-xl">
        <p class="text-green-100 text-sm">Pedidos recibidos</p>
        <h2 class="text-4xl font-black mt-1">${recibidos.length}</h2>
      </div>
    </div>

    <!-- Pendientes -->
    ${pendientes.length > 0 ? `
      <div class="mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-black text-gray-800">📋 Pendientes de recibir</h2>
          ${pendientes.length > 0 ? `
            <button onclick="marcarTodosRecibidos()"
              class="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-3 py-2 rounded-xl font-bold transition">
              ✓ Marcar todos como recibidos
            </button>
          ` : ''}
        </div>
        <div class="space-y-4">
          ${pendientes.map(p => renderPedido(p)).join('')}
        </div>
      </div>
    ` : `
      <div class="bg-white rounded-3xl p-10 text-center shadow-sm border border-dashed border-gray-200 mb-8">
        <div class="text-5xl mb-3">📭</div>
        <p class="text-gray-400 font-semibold">No hay pedidos pendientes</p>
        <p class="text-gray-300 text-sm mt-1">¡Todo en orden!</p>
      </div>
    `}

    <!-- Recibidos -->
    ${recibidos.length > 0 ? `
      <div>
        <h2 class="text-xl font-black text-gray-800 mb-4">✅ Recibidos</h2>
        <div class="space-y-3">
          ${recibidos.map(p => renderPedido(p)).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function renderPedido(p) {
  const esPendiente = p.estado === 'pendiente';
  const fecha = p.fecha || '';
  const itemsHTML = p.items.map(i => `
    <div class="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
      <span class="text-sm text-gray-700 font-medium">${i.nombre}</span>
      <span class="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg">x${i.cantidad}</span>
    </div>
  `).join('');

  return `
    <div class="bg-white rounded-3xl shadow-sm border ${esPendiente ? 'border-amber-100' : 'border-green-100'} p-5">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-black ${esPendiente ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-green-600 bg-green-50 border-green-200'} border px-2 py-0.5 rounded-lg">
              #${fmtId(p.id)}
            </span>
            ${p.clienteNombre ? `<span class="text-sm font-bold text-gray-700">👤 ${p.clienteNombre}</span>` : ''}
            <span class="text-xs ${esPendiente ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'} px-2 py-0.5 rounded-full font-bold">
              ${esPendiente ? '⏳ Pendiente' : '✅ Recibido'}
            </span>
          </div>
          ${p.proveedor ? `<p class="text-xs text-gray-400 mt-1">🏭 ${p.proveedor}</p>` : ''}
          ${fecha ? `<p class="text-xs text-gray-400 mt-0.5">📅 ${fecha}</p>` : ''}
          ${p.notas ? `<p class="text-xs text-gray-500 mt-1 italic">💬 ${p.notas}</p>` : ''}
        </div>
        <div class="flex gap-2">
          <button onclick="editarPedido(${p.id})" class="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 text-sm flex items-center justify-center hover:bg-blue-100 transition">✏️</button>
          <button onclick="eliminarPedido(${p.id})" class="w-9 h-9 rounded-xl bg-red-50 text-red-600 text-sm flex items-center justify-center hover:bg-red-100 transition">🗑️</button>
        </div>
      </div>

      <div class="bg-gray-50 rounded-2xl p-3 mb-3">
        ${itemsHTML}
      </div>

      ${esPendiente ? `
        <div class="flex gap-2 mt-2">
          <button onclick="marcarPedidoRecibido(${p.id})"
            class="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-2xl font-semibold text-sm transition">
            ✅ Marcar como recibido
          </button>
          <button onclick="wspPedidoIndividual(${p.id})"
            class="bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-4 py-3 rounded-2xl font-semibold text-sm transition">
            📲
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function abrirFormularioPedido(pedidoExistente = null) {
  const itemsIniciales = pedidoExistente?.items || [{ nombre: '', cantidad: 1 }];

  const buildItemsHTML = (items) => items.map((item, i) => `
    <div class="flex gap-2 mb-2 item-row" data-index="${i}">
      <input
        class="flex-1 p-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-amber-400 item-nombre"
        placeholder="Nombre del producto"
        value="${item.nombre || ''}"
      >
      <input
        type="number"
        min="1"
        class="w-20 p-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-amber-400 item-cantidad"
        placeholder="Cant."
        value="${item.cantidad || 1}"
      >
      <button onclick="quitarItemPedido(this)" class="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center text-lg flex-shrink-0">×</button>
    </div>
  `).join('');

  document.getElementById('modalContent').innerHTML = `
    <div class="p-6 max-h-[90vh] overflow-y-auto">
      <h2 class="text-2xl font-black mb-5">${pedidoExistente ? 'Editar Pedido' : 'Nuevo Pedido'}</h2>

      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Cliente que lo pidió <span class="text-gray-400 font-normal">(opcional)</span></label>
        <select id="pedidoCliente" class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-amber-400">
          <option value="">Sin cliente específico</option>
          ${db.clientes.map(c => `<option value="${c.nombre}" ${pedidoExistente?.clienteNombre === c.nombre ? 'selected' : ''}>${c.nombre}</option>`).join('')}
        </select>
      </div>

      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-2">Proveedor <span class="text-gray-400 font-normal">(opcional)</span></label>
        <input id="pedidoProveedor" placeholder="Ej: Distribuidora XYZ" value="${pedidoExistente?.proveedor || ''}"
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-amber-400">
      </div>

      <div class="mb-4">
        <label class="block text-sm font-bold text-gray-700 mb-3">Productos a pedir</label>
        <div id="itemsPedido">
          ${buildItemsHTML(itemsIniciales)}
        </div>
        <button onclick="agregarItemPedido()"
          class="mt-2 w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-semibold text-sm hover:border-amber-400 hover:text-amber-600 transition">
          + Agregar otro producto
        </button>
      </div>

      <div class="mb-6">
        <label class="block text-sm font-bold text-gray-700 mb-2">Notas <span class="text-gray-400 font-normal">(opcional)</span></label>
        <textarea id="pedidoNotas" rows="2" placeholder="Ej: Pedir talla XL, color azul..."
          class="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-amber-400 resize-none text-sm">${pedidoExistente?.notas || ''}</textarea>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <button onclick="guardarPedido(${pedidoExistente ? pedidoExistente.id : 'null'})"
          class="bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-2xl font-bold transition">
          Guardar Pedido
        </button>
        <button onclick="cerrarModal()" class="bg-gray-200 hover:bg-gray-300 py-3 rounded-2xl font-bold transition">
          Cancelar
        </button>
      </div>
    </div>
  `;
  document.getElementById('modal').classList.remove('hidden');
}

function agregarItemPedido() {
  const container = document.getElementById('itemsPedido');
  const index = container.querySelectorAll('.item-row').length;
  const div = document.createElement('div');
  div.className = 'flex gap-2 mb-2 item-row';
  div.dataset.index = index;
  div.innerHTML = `
    <input class="flex-1 p-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-amber-400 item-nombre" placeholder="Nombre del producto">
    <input type="number" min="1" value="1" class="w-20 p-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-amber-400 item-cantidad" placeholder="Cant.">
    <button onclick="quitarItemPedido(this)" class="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center text-lg flex-shrink-0">×</button>
  `;
  container.appendChild(div);
}

function quitarItemPedido(btn) {
  const row = btn.closest('.item-row');
  const container = document.getElementById('itemsPedido');
  if (container.querySelectorAll('.item-row').length > 1) {
    row.remove();
  } else {
    Swal.fire({ icon: 'warning', title: 'Debe haber al menos un producto', toast: true, position: 'top-end', timer: 1500, showConfirmButton: false });
  }
}

function guardarPedido(id) {
  const rows = document.querySelectorAll('#itemsPedido .item-row');
  const items = [];
  rows.forEach(row => {
    const nombre = row.querySelector('.item-nombre').value.trim();
    const cantidad = parseInt(row.querySelector('.item-cantidad').value) || 1;
    if (nombre) items.push({ nombre, cantidad });
  });

  if (items.length === 0) {
    return Swal.fire({ icon: 'warning', title: 'Agregá al menos un producto' });
  }

  const pedido = {
    id: id !== null ? id : (++db.pedidoCounter, db.pedidoCounter),
    fecha: new Date().toLocaleDateString('es-AR'),
    clienteNombre: document.getElementById('pedidoCliente').value || '',
    proveedor: document.getElementById('pedidoProveedor').value.trim(),
    notas: document.getElementById('pedidoNotas').value.trim(),
    items,
    estado: 'pendiente'
  };

  if (id !== null) {
    const idx = db.pedidos.findIndex(p => p.id == id);
    if (idx !== -1) {
      pedido.estado = db.pedidos[idx].estado; // conservar estado
      db.pedidos[idx] = pedido;
    }
  } else {
    db.pedidoCounter = pedido.id;
    db.pedidos.push(pedido);
  }

  saveDB();
  cerrarModal();
  showTab(7);

  Swal.fire({
    icon: 'success', title: 'Pedido guardado',
    toast: true, position: 'top-end', timer: 2000, showConfirmButton: false
  });
}

function editarPedido(id) {
  abrirFormularioPedido(db.pedidos.find(p => p.id == id));
}

function eliminarPedido(id) {
  Swal.fire({
    title: '¿Eliminar pedido?', icon: 'warning',
    showCancelButton: true, confirmButtonText: 'Eliminar',
    cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444'
  }).then(r => {
    if (r.isConfirmed) {
      db.pedidos = db.pedidos.filter(p => p.id != id);
      saveDB();
      showTab(7);
    }
  });
}

function marcarPedidoRecibido(id) {
  const pedido = db.pedidos.find(p => p.id == id);
  if (!pedido) return;
  pedido.estado = 'recibido';
  pedido.fechaRecibido = new Date().toLocaleDateString('es-AR');
  saveDB();
  showTab(7);
  Swal.fire({ icon: 'success', title: '¡Pedido recibido!', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
}

function marcarTodosRecibidos() {
  Swal.fire({
    title: '¿Marcar todos como recibidos?',
    icon: 'question', showCancelButton: true,
    confirmButtonText: 'Sí, todos', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a'
  }).then(r => {
    if (r.isConfirmed) {
      db.pedidos.filter(p => p.estado === 'pendiente').forEach(p => {
        p.estado = 'recibido';
        p.fechaRecibido = new Date().toLocaleDateString('es-AR');
      });
      saveDB();
      showTab(7);
    }
  });
}

// ── WhatsApp: lista completa de pedidos pendientes ────────────────────────────
function wspListaPedidos() {
  const pendientes = db.pedidos.filter(p => p.estado === 'pendiente');
  if (pendientes.length === 0) {
    return Swal.fire({ icon: 'info', title: 'No hay pedidos pendientes', text: 'Agregá pedidos primero.' });
  }

  const hoy = new Date().toLocaleDateString('es-AR');
  let texto = `📋 *LISTA DE PEDIDOS — OneShop*\n📅 ${hoy}\n`;
  texto += `${'─'.repeat(30)}\n\n`;

  pendientes.forEach((p, i) => {
    texto += `*${i + 1}. `;
    if (p.clienteNombre) texto += `Cliente: ${p.clienteNombre} — `;
    if (p.proveedor) texto += `Proveedor: ${p.proveedor}`;
    texto += `*\n`;
    p.items.forEach(item => {
      texto += `   • ${item.nombre} × ${item.cantidad}\n`;
    });
    if (p.notas) texto += `   💬 ${p.notas}\n`;
    texto += `\n`;
  });

  texto += `${'─'.repeat(30)}\n`;
  texto += `Total: ${pendientes.length} pedido${pendientes.length !== 1 ? 's' : ''} pendiente${pendientes.length !== 1 ? 's' : ''}`;

  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}

// ── WhatsApp: pedido individual ───────────────────────────────────────────────
function wspPedidoIndividual(id) {
  const p = db.pedidos.find(x => x.id == id);
  if (!p) return;

  let texto = `📦 *PEDIDO #${fmtId(p.id)}*\n`;
  if (p.clienteNombre) texto += `👤 Cliente: ${p.clienteNombre}\n`;
  if (p.proveedor) texto += `🏭 Proveedor: ${p.proveedor}\n`;
  texto += `📅 ${p.fecha}\n\n`;
  texto += `*Productos:*\n`;
  p.items.forEach(item => {
    texto += `• ${item.nombre} × ${item.cantidad}\n`;
  });
  if (p.notas) texto += `\n💬 ${p.notas}`;

  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}

// ===============================
// WHATSAPP
// ===============================

function normalizarNumeroWhatsApp(telefono) {
  if (!telefono) return null;
  let numero = telefono.replace(/[\s\-()]/g, '');
  if (numero.startsWith('+')) return numero;
  if (numero.startsWith('54') && numero.length > 2) return '+' + numero;
  if (numero.startsWith('9') && numero.length > 9) return '+54' + numero;
  if (!numero.startsWith('9') && numero.length === 10) return '+549' + numero;
  return '+54' + numero;
}

function enviarComprobanteWhatsApp(venta, monto) {
  const ahora = new Date();
  const esQuincenal = venta.esQuincenal || venta.cuotasTotales === 12;
  let cuotasInfo = venta.cuotasTotales === 1 ? 'PAGO UNICO - CONTADO'
    : esQuincenal ? `PLAN QUINCENAL\nQuincenas pagadas: ${venta.cuotasPagadas}\nMonto restante: $${venta.saldo.toLocaleString()}`
    : `Cuota: ${venta.cuotasPagadas} de ${venta.cuotasTotales}\nCuotas restantes: ${venta.cuotasTotales - venta.cuotasPagadas}\nMonto restante: $${venta.saldo.toLocaleString()}`;

  let itemsTexto = '';
  venta.items.forEach(item => { itemsTexto += `\n- ${item.nombre} x${item.cantidad}: $${item.subtotal.toLocaleString()}`; });

  const texto = `COMPROBANTE DE PAGO\n==================\n\nFecha: ${ahora.toLocaleDateString('es-AR')}\nHora: ${ahora.toLocaleTimeString('es-AR')}\n\nCLIENTE: ${venta.clienteNombre}\nN° Venta: ${fmtId(venta.id)}\n\nARTICULOS PAGADOS:${itemsTexto}\n\nMONTO PAGADO: $${monto.toLocaleString()}\n\nESTADO DE PAGOS:\n${cuotasInfo}\n\n==================\nMuchas gracias por tu compra!\nEsperamos verte pronto`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}

window.descargarComprobantePago = function(ventaId, monto) {
  const venta = db.ventas.find(v => v.id == ventaId);
  if (!venta) return;
  descargarPDFComprobante(venta, monto);
};

window.wspComprobantePago = function(ventaId, monto) {
  const venta = db.ventas.find(v => v.id == ventaId);
  const cliente = db.clientes.find(c => c.nombre === venta?.clienteNombre);
  if (!cliente?.telefono) {
    Swal.fire({ icon: 'warning', title: 'Sin teléfono', text: 'El cliente no tiene número registrado. Editalo en la sección Clientes.', confirmButtonText: 'Entendido' });
    return;
  }
  const numero = normalizarNumeroWhatsApp(cliente.telefono);
  if (!numero) {
    Swal.fire({ icon: 'error', title: 'Número inválido', text: 'El número del cliente no tiene el formato correcto.', confirmButtonText: 'Entendido' });
    return;
  }
  const msg = `Hola ${cliente.nombre}, te envío el comprobante de pago de $${monto.toLocaleString()}. ¡Gracias!`;
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.descargarComprobanteCompleto = function(ventaId) {
  const venta = db.ventas.find(v => v.id == ventaId);
  if (!venta) return;
  descargarPDFComprobante(venta, venta.total);
};

window.wspComprobanteCompleto = function(ventaId) {
  const venta = db.ventas.find(v => v.id == ventaId);
  const cliente = db.clientes.find(c => c.nombre === venta?.clienteNombre);
  if (!cliente?.telefono) {
    Swal.fire({ icon: 'warning', title: 'Sin teléfono', text: 'El cliente no tiene número registrado. Editalo en la sección Clientes.', confirmButtonText: 'Entendido' });
    return;
  }
  const numero = normalizarNumeroWhatsApp(cliente.telefono);
  if (!numero) {
    Swal.fire({ icon: 'error', title: 'Número inválido', text: 'El número del cliente no tiene el formato correcto.', confirmButtonText: 'Entendido' });
    return;
  }
  const msg = `Hola ${cliente.nombre}, tu compra por $${venta.total.toLocaleString()} está completamente pagada. ¡Gracias por elegirnos!`;
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(msg)}`, '_blank');
};

function borrarPago(ventaId) {
  Swal.fire({
    title: '¿Borrar esta venta?', text: 'Se restaurará el stock y se eliminará del historial',
    icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444',
    confirmButtonText: 'Sí, borrar', cancelButtonText: 'Cancelar'
  }).then(r => {
    if (r.isConfirmed) {
      const venta = db.ventas.find(v => v.id == ventaId);
      if (venta) {
        venta.items.forEach(item => {
          const producto = db.productos.find(p => p.id == item.id) || db.productos.find(p => p.nombre === item.nombre);
          if (producto) producto.stock += item.cantidad;
        });
        const cliente = db.clientes.find(c => c.nombre === venta.clienteNombre);
        if (cliente) { cliente.compras = Math.max(0, (cliente.compras || 0) - venta.total); }
        db.ventas = db.ventas.filter(v => v.id != ventaId);
        saveDB();
        Swal.fire({ icon: 'success', title: 'Venta eliminada', text: 'Stock restaurado', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
        showTab(6);
      }
    }
  });
}

function compartirPorWhatsApp() {
  let texto = '========================\n       CATALOGO\n========================\n\n';
  db.productos.forEach((p, index) => {
    texto +=
      `${index + 1}. ${p.nombre.toUpperCase()}\n` +
      `------------------------\n` +
      `PRECIO CONTADO: $${p.precioContado.toLocaleString()}\n\n` +
      `Opciones de pago:\n` +
      `🗓 Quincenal: $${p.preciosCuotas?.[12] || 0}\n` +
      `- 4 cuotas de $${p.preciosCuotas?.[4] || 0} (Total: $${((p.preciosCuotas?.[4] || 0) * 4).toLocaleString()})\n` +
      `- 6 cuotas de $${p.preciosCuotas?.[6] || 0} (Total: $${((p.preciosCuotas?.[6] || 0) * 6).toLocaleString()})\n` +
      `- 8 cuotas de $${p.preciosCuotas?.[8] || 0} (Total: $${((p.preciosCuotas?.[8] || 0) * 8).toLocaleString()})\n\n` +
      `Stock disponible: ${p.stock} unidades\n\n`;
  });
  texto += '------------------------\nConsulta sin compromiso!\n';
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
}

// ===============================
// EXPORTAR / CARGAR DATOS
// ===============================

function descargarDatos() {
  const datosExportar = {
    clientes: db.clientes,
    productos: db.productos,
    ventas: db.ventas,
    pagos: db.pagos,
    pedidos: db.pedidos,
    ventaCounter: db.ventaCounter,
    pedidoCounter: db.pedidoCounter,
    fechaExporto: new Date().toLocaleString('es-AR')
  };
  const json = JSON.stringify(datosExportar, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `datos-oneshop-${Date.now()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  Swal.fire({ icon: 'success', title: 'Datos descargados', text: 'El archivo se guardó en descargas', toast: true, position: 'top-end', timer: 2000, showConfirmButton: false });
}

function cargarDatos() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const datos = JSON.parse(event.target.result);
        if (!datos.clientes || !datos.productos || !datos.ventas) throw new Error('Archivo inválido');
        Swal.fire({
          title: '¿Reemplazar todos los datos?', text: 'Se reemplazarán clientes, productos, ventas y pagos',
          icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, reemplazar', cancelButtonText: 'Cancelar'
        }).then(result => {
          if (result.isConfirmed) {
            db.clientes = datos.clientes || [];
            db.productos = datos.productos || [];
            db.ventas = datos.ventas || [];
            db.pagos = datos.pagos || [];
            db.pedidos = datos.pedidos || [];
            db.ventaCounter = datos.ventaCounter || 0;
            db.pedidoCounter = datos.pedidoCounter || 0;
            saveDB();
            Swal.fire({ icon: 'success', title: 'Datos cargados', text: 'Los datos se han importado correctamente', confirmButtonText: 'Recargar app' }).then(() => location.reload());
          }
        });
      } catch (error) {
        Swal.fire({ icon: 'error', title: 'Error al cargar', text: 'El archivo no es válido o está corrupto' });
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ── Recalcular saldos desde historialPagos ────────────────────────────────────
function recalcularSaldos() {
  Swal.fire({
    title: '¿Recalcular saldos?',
    html: `<p>Se va a recalcular el <b>saldo</b> de cada venta sumando los montos de <b>historialPagos</b>.</p>
           <p style="color:#d97706;margin-top:8px;">⚠️ Hacé una copia de seguridad antes (botón "Descargar datos").</p>`,
    icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, recalcular', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706'
  }).then(r => {
    if (!r.isConfirmed) return;
    let corregidas = 0;
    db.ventas.forEach(v => {
      let totalPagado = 0;
      if (v.entrega > 0) totalPagado += v.entrega;
      if (v.historialPagos?.length) v.historialPagos.forEach(p => { totalPagado += p.monto; });
      let saldoReal, pagadoReal;
      if (totalPagado > 0) {
        saldoReal = Math.max(0, (v.total || 0) - totalPagado);
        pagadoReal = totalPagado;
      } else if (v.cuotasTotales === 1) {
        saldoReal = 0;
        pagadoReal = v.total || 0;
      } else {
        saldoReal = v.total || 0;
        pagadoReal = 0;
      }
      if (v.saldo !== saldoReal) {
        v.saldo = saldoReal;
        v.pagado = pagadoReal;
        corregidas++;
      }
    });
    saveDB();
    Swal.fire({ icon: 'success', title: 'Listo', text: `${corregidas} ventas corregidas. Recargá la página.`, confirmButtonText: 'OK' });
  });
}

// ── Reporte de ventas en PDF ──────────────────────────────────────────────────
function descargarReporteVentas() {
  const cargarLib = () => new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('Timeout cargando jsPDF')), 8000);
  });
  cargarLib().then(() => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 15, A = W - M * 2;
    let y = 18;
    const CV = [124,58,237], CN = [31,41,55], CG = [107,114,128], CFG = [243,244,246];

    doc.setFillColor(...CV); doc.rect(M, y, A, 0.7, 'F'); y += 4;
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...CV);
    doc.text('REPORTE DE VENTAS — OneShop', W/2, y+5, { align:'center' }); y += 10;
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...CG);
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')} · Total ventas: ${db.ventas.length}`, W/2, y+3, { align:'center' }); y += 10;
    doc.setFillColor(...CV); doc.rect(M, y, A, 0.4, 'F'); y += 6;

    doc.setFillColor(...CFG); doc.rect(M, y-3, A, 7, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...CN);
    doc.text('N°', M+2, y+1);
    doc.text('Cliente', M+18, y+1);
    doc.text('Fecha', M+75, y+1);
    doc.text('Modalidad', M+100, y+1);
    doc.text('Saldo', M+130, y+1);
    doc.text('Total', A+M, y+1, { align:'right' });
    y += 8;

    const ventas = [...db.ventas].sort((a,b) => (b.id||0)-(a.id||0));
    ventas.forEach((v, i) => {
      if (y > 270) { doc.addPage(); y = 18; }
      if (i % 2 === 0) { doc.setFillColor(249,250,251); doc.rect(M, y-3, A, 7, 'F'); }
      doc.setFont('helvetica','bold'); doc.setFontSize(8);
      doc.setTextColor(...[124,58,237]); doc.text('#'+fmtId(v.id), M+2, y+1);
      doc.setTextColor(...CN);
      doc.setFont('helvetica','normal');
      const nombre = v.clienteNombre.length>28 ? v.clienteNombre.substring(0,26)+'…' : v.clienteNombre;
      doc.text(nombre, M+18, y+1);
      doc.text(v.fecha||'', M+75, y+1);
      const mod = v.esQuincenal ? 'Quincenal' : v.cuotasTotales===1 ? 'Contado' : v.cuotasTotales+'c';
      doc.text(mod, M+100, y+1);
      if (v.saldo > 0) { doc.setTextColor(220,38,38); } else { doc.setTextColor(22,163,74); }
      doc.text('$'+v.saldo.toLocaleString(), M+130, y+1);
      doc.setTextColor(...CN); doc.setFont('helvetica','bold');
      doc.text('$'+v.total.toLocaleString(), A+M, y+1, { align:'right' });
      y += 7;
    });

    y += 4;
    doc.setFillColor(...CFG); doc.rect(M, y-3, A, 10, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...CN);
    const totalVentas = db.ventas.reduce((s,v)=>s+v.total,0);
    const totalPend = db.ventas.reduce((s,v)=>s+v.saldo,0);
    doc.text('TOTAL VENDIDO:', M+2, y+3);
    doc.setTextColor(...[124,58,237]);
    doc.text('$'+totalVentas.toLocaleString(), M+50, y+3);
    doc.setTextColor(...CN); doc.text('SALDO PENDIENTE:', M+100, y+3);
    doc.setTextColor(220,38,38);
    doc.text('$'+totalPend.toLocaleString(), M+145, y+3);

    doc.save(`Reporte-Ventas-${new Date().toISOString().slice(0,10)}.pdf`);
  }).catch(e => {
    console.error('Error generando reporte:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo generar el reporte. Verificá tu conexión.' });
  });
}

// ── Reporte de pagos en PDF ───────────────────────────────────────────────────
function descargarReportePagos() {
  const cargarLib = () => new Promise((resolve, reject) => {
    if (window.jspdf) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload = resolve; s.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('Timeout cargando jsPDF')), 8000);
  });
  cargarLib().then(() => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 15, A = W - M * 2;
    let y = 18;
    const CV = [22,163,74], CN = [31,41,55], CG = [107,114,128], CFG = [243,244,246];

    const todosPagos = [];
    db.ventas.forEach(v => {
      if (v.historialPagos?.length) {
        v.historialPagos.forEach(p => todosPagos.push({ ventaId:v.id, cliente:v.clienteNombre, monto:p.monto, fecha:p.fecha }));
      } else if (v.pagado > 0) {
        todosPagos.push({ ventaId:v.id, cliente:v.clienteNombre, monto:v.pagado, fecha:v.fecha });
      }
    });
    const fmtF = f => {
      if (!f) return '';
      if (typeof f==='string' && f.includes('/')) return f;
      const d = new Date(f); return isNaN(d) ? String(f) : d.toLocaleDateString('es-AR');
    };
    todosPagos.sort((a,b) => String(b.fecha).localeCompare(String(a.fecha)));
    const totalCobrado = todosPagos.reduce((s,p)=>s+p.monto,0);

    doc.setFillColor(...CV); doc.rect(M, y, A, 0.7, 'F'); y += 4;
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...CV);
    doc.text('REPORTE DE PAGOS — OneShop', W/2, y+5, { align:'center' }); y += 10;
    doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...CG);
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')} · ${todosPagos.length} pagos registrados`, W/2, y+3, { align:'center' }); y += 10;
    doc.setFillColor(...CV); doc.rect(M, y, A, 0.4, 'F'); y += 6;

    doc.setFillColor(...CFG); doc.rect(M, y-3, A, 7, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...CN);
    doc.text('N° Venta', M+2, y+1);
    doc.text('Cliente', M+28, y+1);
    doc.text('Fecha pago', M+100, y+1);
    doc.text('Monto', A+M, y+1, { align:'right' });
    y += 8;

    todosPagos.forEach((p, i) => {
      if (y > 270) { doc.addPage(); y = 18; }
      if (i % 2 === 0) { doc.setFillColor(249,250,251); doc.rect(M, y-3, A, 7, 'F'); }
      doc.setFont('helvetica','bold'); doc.setFontSize(8);
      doc.setTextColor(...[124,58,237]); doc.text('#'+fmtId(p.ventaId), M+2, y+1);
      doc.setTextColor(...CN); doc.setFont('helvetica','normal');
      const nombre = p.cliente.length>38 ? p.cliente.substring(0,36)+'…' : p.cliente;
      doc.text(nombre, M+28, y+1);
      doc.text(fmtF(p.fecha), M+100, y+1);
      doc.setFont('helvetica','bold'); doc.setTextColor(...CV);
      doc.text('+$'+p.monto.toLocaleString(), A+M, y+1, { align:'right' });
      y += 7;
    });

    y += 4;
    doc.setFillColor(...CFG); doc.rect(M, y-3, A, 10, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...CN);
    doc.text('TOTAL COBRADO:', M+2, y+3);
    doc.setTextColor(...CV);
    doc.text('$'+totalCobrado.toLocaleString(), M+50, y+3);

    doc.save(`Reporte-Pagos-${new Date().toISOString().slice(0,10)}.pdf`);
  }).catch(e => {
    console.error('Error generando reporte:', e);
    Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo generar el reporte. Verificá tu conexión.' });
  });
}

// ===============================
// CERRAR MODAL
// ===============================

function cerrarModal() {
  document.getElementById('modal').classList.add('hidden');
}

// ===============================
// INIT
// ===============================

async function iniciarApp() {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = `
      <div class="flex items-center justify-center min-h-screen">
        <div class="text-center">
          <div class="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p class="text-gray-600 font-semibold">Conectando con Supabase...</p>
        </div>
      </div>
    `;
  }

  await window._supabaseReady;

  const datosCloud = await cargarDatosSupabase();
  const localHasData = db.productos.length > 0 || db.clientes.length > 0 || db.ventas.length > 0;

  if (datosCloud && !localHasData) {
    aplicarDatosCloud(datosCloud);
    console.log('Datos cargados desde Supabase (sin datos locales)');
  } else if (localHasData) {
    console.log('Usando datos locales (siempre prioridad local)');
    await saveDB();
  } else {
    console.log('Sin datos locales ni en Supabase');
  }

  suscribirCambiosSupabase();
  showTab(0);
  if (window._ocultarSplash) window._ocultarSplash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciarApp);
} else {
  iniciarApp();
}