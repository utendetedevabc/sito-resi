# Unit systemd — Sito Resi

I due file in questa cartella sono la copia versionata degli unit **attivi** in
`~/.config/systemd/user/` (il gestore utente legge solo lì, non da qui).

## Cosa fanno

- `sito-resi.socket` — tiene aperta la porta **:3003 in permanenza** (socket
  activation). Durante i riavvii del sito (deploy) o un crash, le connessioni
  si mettono in coda invece di essere rifiutate: **il sito non risulta mai
  "irraggiungibile"**.
- `sito-resi.service` — servizio prod (`node server.js` con `.env.prod`),
  `Restart=always`, collegato al socket.

## Installazione (già attiva il 19/10/2026 — qui per reinstallazione)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/sito-resi.socket systemd/sito-resi.service ~/.config/systemd/user/
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user daemon-reload
systemctl --user stop sito-resi.service          # libera la :3003
systemctl --user enable --now sito-resi.socket   # systemd prende la porta
systemctl --user start sito-resi.service
```

## Note

- Se si modifica un unit qui, ricopiarlo in `~/.config/systemd/user/` e dare
  `systemctl --user daemon-reload`.
- `server.js` ascolta sul socket passato da systemd (fd 3) quando
  `LISTEN_FDS` è impostato; senza systemd (dev, avvio manuale) fa fallback a
  host:porta — nessuna configurazione extra.
- Con il socket attivo `lsof -ti:3003` mostra **systemd** anche a servizio
  fermo: la porta resta in LISTEN, non è il processo node.
- I deploy vanno fatti con `./deploy.sh` (o `./deploy.sh --veloce` per sole
  modifiche backend), mai con kill generici.