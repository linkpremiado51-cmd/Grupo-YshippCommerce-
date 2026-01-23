/**
 * Repositório de Notícias - AniGeekNews
 * Responsabilidade: Abstrair todas as consultas ao Firestore relacionadas a notícias.
 */

import { db } from '../infraestrutura-firebase/firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    orderBy, 
    limit,
    doc,
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Busca notícias filtradas por categoria (para uso nas abas).
 * @param {string} categoria - Ex: 'analises', 'futebol'
 * @param {number} quantidade - Limite de documentos
 */
export async function buscarNoticiasPorCategoria(categoria, quantidade = 10) {
    try {
        const noticiasRef = collection(db, "noticias");
        const q = query(
            noticiasRef, 
            where("categoria", "==", categoria),
            orderBy("dataPublicacao", "desc"),
            limit(quantidade)
        );

        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error(`Erro ao buscar notícias da categoria ${categoria}:`, error);
        return [];
    }
}

/**
 * Busca as notícias mais recentes (Geral para a aba Início).
 */
export async function buscarUltimasNoticias(quantidade = 6) {
    try {
        const noticiasRef = collection(db, "noticias");
        const q = query(
            noticiasRef, 
            orderBy("dataPublicacao", "desc"), 
            limit(quantidade)
        );

        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error("Erro ao buscar últimas notícias:", error);
        return [];
    }
}

/**
 * Busca uma notícia específica pelo ID (para o sistema de recomendação ou busca).
 */
export async function buscarNoticiaPorId(id) {
    try {
        const docRef = doc(db, "noticias", id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    } catch (error) {
        console.error("Erro ao buscar notícia por ID:", error);
        throw error;
    }
}
