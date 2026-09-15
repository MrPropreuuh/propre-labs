# Propre Labs : site auto-hébergé sur Raspberry Pi derrière un tunnel Cloudflare

## 🎯 Objectif

Servir [propre-labs.com](https://propre-labs.com), un tableau de bord de statistiques de jeu mis à jour en continu, depuis un Raspberry Pi domestique : sans port ouvert sur la box, sans clé API exposée au navigateur, et sans que le trafic des visiteurs n'influe sur la consommation de l'API tierce.

---

## 🏗️ Architecture & Flux

```text
 Visiteur ──HTTPS──▶ Cloudflare (DNS + TLS)
                          ▲
                          │ connexion SORTANTE initiée par le Pi : aucun port ouvert sur la box
┌─ Raspberry Pi · ARM64 · Docker Compose ─┼────────────────────────────────────────────────┐
│                                         │                                                │
│   cloudflared ──── réseau bridge « internal » (aucun port publié sur l'hôte) ────┐       │
│                                                                                  ▼       │
│                                        web : nginx:alpine :80                            │
│                                          ├─ /          build statique Astro (cache 1 an) │
│                                          └─ /data/     JSON live (no-store)              │
│                                                  ▲                                       │
│                                                  │ volume « mrdata » monté en LECTURE    │
│                                                  │                                       │
│   fetcher : node:20-alpine ── toutes les 300 s ──┘ écriture atomique (tmp + rename)      │
│        │                                                                                 │
└────────┼─────────────────────────────────────────────────────────────────────────────────┘
         ▼
   API tierce (clé API côté serveur uniquement)
```

| Service | Image | Rôle |
| --- | --- | --- |
| `cloudflared` | `cloudflare/cloudflared` | Tunnel sortant vers Cloudflare, route `propre-labs.com` → `http://web:80` |
| `web` | build multi-stage → `nginx:alpine` | Sert le site statique et le JSON produit par le fetcher |
| `fetcher` | `node:20-alpine` | Interroge l'API tierce en tâche de fond et publie `/data/player.json` |

**Build :** `node:20-alpine` (npm install, `astro build`) → copie de `dist/` dans `nginx:alpine`.
**Déploiement :** poste de dev ─ `git archive` via SSH ─▶ Pi ─ `docker compose up -d --build`.

### Stack

| Couche | Technologie |
| --- | --- |
| Front | Astro 4 (sortie statique), îlots React 18, Tailwind CSS, Framer Motion, Three.js |
| Serveur web | nginx (alpine) |
| Collecte | Node.js 20, `fetch` natif, zéro dépendance |
| Orchestration | Docker Compose, réseau bridge interne, volume nommé |
| Exposition | Cloudflare Tunnel (`cloudflared`) |
| Matériel | Raspberry Pi, ARM64 |

---

## 🛠️ Choix Techniques & « Moyens du Bord »

### Tunnel sortant plutôt que redirection de port
Le Pi ouvre lui-même la connexion vers Cloudflare. Rien n'écoute sur l'IP publique de la box : pas de redirection NAT, IP résidentielle masquée, TLS et certificats gérés en bordure, et le site survit à un changement d'IP dynamique.

### Aucun port publié, même sur le réseau local
Les services utilisent `expose` et non `ports` : nginx n'est joignable que par `cloudflared`, sur le réseau Docker interne. Un appareil du LAN ne peut pas contourner le tunnel.

### Collecteur découplé du trafic (sidecar)
La première version appelait l'API tierce depuis le navigateur, ce qui exposait la clé et consommait le quota à chaque visite. Le `fetcher` tourne désormais en tâche de fond :

- la clé API ne quitte jamais le serveur ;
- la consommation d'API est constante (un cycle toutes les 5 min), qu'il y ait 1 ou 10 000 visiteurs ;
- si l'API tombe, nginx continue de servir le dernier JSON valide et le front affiche « Last known data ».

### Écriture atomique
Le fetcher écrit `player.json.tmp` puis fait un `rename`, qui est atomique sur le même système de fichiers : nginx ne sert jamais un JSON à moitié écrit.

### Moindre privilège
Le volume de données est monté **en lecture seule** dans `web`. Seul `fetcher` peut y écrire, et la configuration du tunnel est montée en lecture seule dans `cloudflared`, qui tourne sous l'UID de l'hôte pour lire des identifiants restés en `600`.

### Image finale minimale
Build multi-stage : Node et `node_modules` restent dans l'étape de build. L'image servie ne contient que nginx et les fichiers statiques, ce qui réduit sa taille et sa surface d'attaque.

### Politique de cache nginx
| Chemin | En-tête | Raison |
| --- | --- | --- |
| Assets (`.js`, `.css`, images, polices) | `public, immutable`, 1 an | Noms hachés par Astro : un nouveau build change l'URL |
| `/data/` | `no-cache, no-store` | Données live, toujours fraîches |

Compression gzip et en-têtes de sécurité (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) sont activés.

### Contraintes ARM64
Images officielles multi-architecture et build directement sur le Pi : pas de registre d'images ni de cross-compilation. `restart: unless-stopped` relance les conteneurs après une coupure de courant.

### Front léger
Astro génère du HTML statique ; seuls le tableau de bord et le fond animé sont hydratés côté client. Le fond Three.js respecte `prefers-reduced-motion` et libère ses ressources GPU au démontage.

---

## 🚀 Déploiement

### Prérequis sur le Pi
- Docker et le plugin Compose
- Accès SSH par clé depuis le poste de dev

### 1. Tunnel Cloudflare (une seule fois, sur le Pi)

```bash
mkdir -p ~/.cloudflared/propre-labs && chmod 700 ~/.cloudflared/propre-labs
cloudflared tunnel login
cloudflared tunnel create propre-labs
cloudflared tunnel token --cred-file ~/.cloudflared/propre-labs/credentials.json propre-labs
cloudflared tunnel route dns propre-labs propre-labs.com
cp cloudflared-config.yml ~/.cloudflared/propre-labs/config.yml     # renseigner <TUNNEL_ID>
```

Le dossier est dédié : le même Pi héberge d'autres tunnels dans `~/.cloudflared`.

### 2. Variables d'environnement (sur le Pi)

```bash
cp .env.example ~/propre-labs/.env && chmod 600 ~/propre-labs/.env   # MARVEL_API_KEY, MARVEL_PLAYER…
```

### 3. Déployer (depuis le poste de dev)

```bash
./deploy.sh                                  # git archive HEAD → Pi, puis docker compose up -d --build
PI_HOST=192.168.1.50 ./deploy.sh             # hôte, utilisateur et dossier surchargeables
```

`git archive` n'envoie que les fichiers versionnés du commit courant : ni `node_modules`, ni build local, ni secret ne peuvent partir sur le Pi par erreur.

### Développement local

```bash
npm install
npm run dev          # http://localhost:4321, affiche les données statiques de repli
```

### Vérification

```bash
ssh vince@<pi> "cd ~/propre-labs && docker compose ps"
ssh vince@<pi> "docker logs --tail 20 propre-labs-fetcher"
curl -I https://propre-labs.com
curl -s https://propre-labs.com/data/player.json | head -c 200
```

---

## ⚠️ Limites & prochaines étapes

- `cloudflare/cloudflared:latest` n'est pas épinglé : fixer une version pour des déploiements reproductibles.
- Pas de `healthcheck` sur `web` et `fetcher` : à ajouter pour que Compose détecte un collecteur bloqué.
- Déploiement manuel depuis le poste de dev : cible suivante, un workflow GitHub Actions avec build multi-arch (`docker buildx`) poussé vers un registre, puis `docker compose pull` sur le Pi.
- Les statistiques « all time » par personnage sont saisies à la main dans le front : l'API ne les expose pas.
