# Chrome-Web-Store-Listing

## Deutsch

**Name:** Fin3000 — Belege aus Chrome senden

**Kurzbeschreibung:** PDF-Druckdarstellungen aus Chrome sicher an den
Fin3000-Belegeingang senden.

**Beschreibung:**

Mit „An Fin3000 senden“ erscheint Fin3000 direkt als Ziel in Chromes
Druckvorschau. Verbinde einmal dein Fin3000-Owner-Konto, öffne eine Rechnung
oder ein anderes Dokument, drücke `Strg+P` und sende die von Chrome erzeugte
PDF-Druckdarstellung an deinen Belegeingang. Erfolg wird erst angezeigt, wenn
Fin3000 das Dokument sicher in der privaten Quarantäne angenommen hat.

Die Erweiterung liest keine Portal-URLs, Cookies oder Webseiten und benötigt
keine Portalberechtigungen. Sie überwacht keine Downloads. Gedruckte
Darstellungen können eingebettete E-Rechnungsdaten, Signaturen oder Anlagen
verlieren; für das autoritative Original nutze Datei-Upload oder Fin3000-E-Mail.

## English

**Name:** Fin3000 — Send documents from Chrome

**Short description:** Securely send PDF print representations from Chrome to
your Fin3000 document inbox.

**Description:**

“Send to Fin3000” adds Fin3000 as a destination in Chrome's normal print
preview. Connect your Fin3000 owner account once, open an invoice or another
document, press `Ctrl+P`, and send the PDF print representation created by
Chrome. Success appears only after Fin3000 has accepted the document into its
private quarantine.

The extension does not read portal URLs, cookies, or web pages and requests no
portal permissions. Printed representations may lose embedded e-invoice data,
signatures, or attachments; use file upload or Fin3000 email for the
authoritative original.

## Begründung der Berechtigungen

| Berechtigung              | Ausschließlicher Zweck                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `printerProvider`         | Zeigt genau das Druckziel „An Fin3000 senden“ an und empfängt den bewusst gesendeten PDF-Druckjob.  |
| `identity`                | Einmalige Owner-Anmeldung per OAuth Authorization Code + PKCE über Chromes geschützten Redirect.    |
| `storage`                 | Speichert Tokens, sichtbaren Kontonamen und opake Wiederanlauf-IDs; nie PDF-Bytes oder Portalwerte. |
| `notifications`           | Meldet sichere Annahme, klaren Fehler oder einen noch zu prüfenden Ausgang.                         |
| Exakte Fin3000-API-Origin | OAuth-Token, Principal und schmale Beleg-Intake-Routen.                                             |
| Exakte Quarantäne-Origin  | Direkter presigned PDF-POST ohne Fin3000-Token.                                                     |

Nicht angefordert werden `tabs`, `cookies`, `webRequest`, Content-Scripts,
Native Messaging oder Portal-Hostrechte.
