// camada-dados/noticias.repository.js

import { db } from '../infraestrutura-firebase/firebase-firestore.js'; import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';

/**

Nome da coleção principal de notícias no Firestore */ const COLLECTION_NOTICIAS = 'noticias';


/**

Busca notícias por categoria (para abas)

@param {Object} params

@param {string} params.categoria

@param {number} params.limite */ export async function buscarNoticiasPorCategoria({ categoria, limite = 10 }) { const noticiasRef = collection(db, COLLECTION_NOTICIAS);


const q = query( noticiasRef, where('categoria', '==', categoria), orderBy('timestamp', 'desc'), limit(limite) );

const snapshot = await getDocs(q);

return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })); }

/**

Busca notícias recentes (aba início)

@param {number} limite */ export async function buscarNoticiasRecentes(limite = 10) { const noticiasRef = collection(db, COLLECTION_NOTICIAS);


const q = query( noticiasRef, orderBy('timestamp', 'desc'), limit(limite) );

const snapshot = await getDocs(q);

return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })); }

/**

Busca uma notícia específica (para páginas completas)

@param {string} id */ export async function buscarNoticiaPorId(id) { const noticiaRef = doc(db, COLLECTION_NOTICIAS, id); const snapshot = await getDoc(noticiaRef);


if (!snapshot.exists()) return null;

return { id: snapshot.id, ...snapshot.data() }; }

/**

Busca notícias relacionadas por tags

@param {Array<string>} tags

@param {number} limite */ export async function buscarNoticiasRelacionadas(tags = [], limite = 5) { if (!tags.length) return [];


const noticiasRef = collection(db, COLLECTION_NOTICIAS);

const q = query( noticiasRef, where('tags', 'array-contains-any', tags), orderBy('timestamp', 'desc'), limit(limite) );

const snapshot = await getDocs(q);

return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })); }
