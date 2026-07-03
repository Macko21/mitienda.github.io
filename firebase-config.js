// ===============================
// CONFIGURACIÓN DE FIREBASE
// ===============================

const firebaseConfig = {
  apiKey: "AIzaSyDhKvTuOOoPraf6fBntEaTbdIE8x2qNY90",
  authDomain: "mi-tienda-682aa.firebaseapp.com",
  databaseURL: "https://mi-tienda-682aa-default-rtdb.firebaseio.com",
  projectId: "mi-tienda-682aa",
  storageBucket: "mi-tienda-682aa.firebasestorage.app",
  messagingSenderId: "160644788328",
  appId: "1:160644788328:web:e2f7a1cec90b933a948bdd"
};

firebase.initializeApp(firebaseConfig);
window.firebaseDB = firebase.database();

console.log('✅ Firebase configurado correctamente');
