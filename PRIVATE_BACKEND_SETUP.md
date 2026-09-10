# BAROMETRE — architecture privée

Cette branche prépare l’authentification privée sans modifier la version publique en production.

## Propriété

- Le frontend GitHub reste maintenu par JB pour les modifications de l’application.
- Le backend Supabase doit appartenir à Max et/ou Charlotte.
- JB ne doit pas être membre administrateur du projet Supabase.
- Aucun code PIN, clé secrète ou donnée métier ne doit être stocké dans le dépôt GitHub public.

## Comptes

- Max : patron, accès complet.
- Charlotte : patronne, accès complet.
- Amaury : employé, accès limité.
- Extra : extra, accès limité.
- Aucun compte utilisateur pour JB.

## Authentification préparée

Le frontend de cette branche affiche un écran « Connexion privée », demande un code à 4 chiffres et conserve uniquement un jeton de session temporaire dans `sessionStorage`.

Les codes PIN ne sont jamais enregistrés dans le navigateur ni dans le dépôt GitHub.

Le fichier `private-auth.js` est volontairement configuré avec une URL backend vide. Il ne faut pas fusionner cette branche dans `main` avant que le backend appartenant au Baromètre soit créé et testé.

## Handoff backend

Une fois le projet Supabase créé par Max ou Charlotte, il suffit de fournir au frontend l’URL publique de la fonction Edge du Baromètre. Cette URL n’est pas un secret. Les clés serveur et les données restent exclusivement dans leur projet Supabase.

## Sécurité attendue côté backend

- PINs stockés uniquement sous forme de hash salé.
- limitation des tentatives et verrouillage temporaire après plusieurs erreurs.
- jetons de session courts et révocables.
- droits contrôlés côté serveur, pas seulement dans l’interface.
- RLS activée sur les tables et aucune politique publique donnant accès aux données.
- clés secrètes Supabase uniquement dans les Edge Functions.
- journalisation des actions sensibles.

La branche `main` doit rester fonctionnelle tant que cette configuration privée n’est pas terminée.
