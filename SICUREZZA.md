# Sicurezza Sito Resi

## Architettura

Sito Resi è un'applicazione Next.js 16 + Express 5 esposta pubblicamente su porta 3002, che comunica con ABC HUB (porta 3001, solo localhost) tramite webhook firmati.

## Autenticazione

- **JWT RS256 asimmetrico**: chiave privata per firmare, pubblica per verificare
- **Access token**: 15 minuti di durata
- **Refresh token**: 7 giorni, memorizzato in cookie `httpOnly` + `SameSite=Strict`
- **Device fingerprinting**: legame tra refresh token e fingerprint del dispositivo
- **Rotation**: ogni refresh invalida il token precedente

## Database

- **SQLite con SQLCipher**: crittografia a riposo tramite passphrase
- **PRAGMA**: journal_mode WAL, foreign_keys ON, secure_delete ON
- **Tutte le query** usano prepared statements

## Sicurezza HTTP

- **Helmet**: CSP strict, HSTS, referrer policy, COEP, COOP, CORP
- **CORS**: solo origine configurata
- **Rate limiting**: globale 100 req/15min, login 5 req/15min
- **CSRF token**: 64 byte esadecimale per ogni form
- **HPP**: protezione HTTP Parameter Pollution

## Input Validation

- **Zod**: validazione strutturale di tutti gli input
- **DOMPurify**: sanificazione HTML (nessun tag consentito)
- **Regex**: numeri ordine e BDA limitati a pattern specifici

## Upload

- **Multer**: storage su disco con filename casuale
- **Sharp**: resize massimo 1920px, strip EXIF, output JPEG quality 85
- **Limite**: 5 file, massimo 5MB ciascuno

## Logging

- **Winston**: log strutturati in JSON
- **Redazione PII**: email, BDA, telefono, codice fiscale, P.IVA automaticamente oscurati
- **Rotazione**: 10MB per file, massimo 30 file

## Webhook verso ABC HUB

- **HMAC-SHA256**: firma di ogni payload
- **Anti-replay**: timestamp entro 5 minuti, nonce cache
- **Retry**: 3 tentativi con backoff esponenziale
- **Solo localhost**: comunicazione su 127.0.0.1, mai su Internet

## Password Policy

- Minimo 12 caratteri
- Almeno 1 maiuscola, 1 minuscola, 1 numero, 1 speciale
- bcrypt 12 rounds + pepper da variabile d'ambiente
- Lockout progressivo: 5 tentativi → 15min, 10 → 1h, 15 → 24h
