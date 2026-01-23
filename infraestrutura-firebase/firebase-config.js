
/**
 * Configuração Central do Firebase - AniGeekNews
 * Responsabilidade: Inicializar o SDK do Firebase e exportar as instâncias dos serviços.
 */

// Importações dos módulos necessários do SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Suas credenciais integradas
const firebaseConfig = {
  apiKey: "AIzaSyAvk_3Cn1yLPUIIW54cZSKmDPOPDKic1PM",
  authDomain: "anigeeknews-commercce.firebaseapp.com",
  projectId: "anigeeknews-commercce",
  storageBucket: "anigeeknews-commercce.firebasestorage.app",
  messagingSenderId: "962918121925",
  appId: "1:962918121925:web:9fb8abd3c7af3d24b08bac",
  measurementId: "G-HRCQLF7MHX"
};

// Inicialização das instâncias
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Exportamos as instâncias para serem usadas exclusivamente pela 'camada-dados' e 'infraestrutura-firebase'
export { app, analytics, db, auth };

console.log("Firebase: Infraestrutura inicializada com sucesso.");
