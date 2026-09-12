# Datenschutz — Fin3000 Chrome-Druckziel

Stand: 31. August 2026

Die Erweiterung verarbeitet ein Dokument nur, wenn der Nutzer in Chromes
Druckvorschau ausdrücklich das Ziel „An Fin3000 senden“ auswählt und auf
„Drucken“ klickt. Chrome übergibt dabei eine erzeugte PDF-Druckdarstellung an
die Erweiterung. Die Erweiterung beobachtet keine Portale und liest weder
Portal-URLs noch Cookies oder Seiteninhalte.

An Fin3000 werden der normalisierte Dokumentname, die Dateigröße, zufällige
Vorgangskennungen und das PDF übertragen. Das PDF geht direkt in eine private,
versionierte Quarantäne und durchläuft dort die bestehende Virenprüfungs-,
Analyse- und Belegverarbeitung. Die serverseitige Aufbewahrung richtet sich
nach dem Fin3000-Vertrag und den Einstellungen des verbundenen Kontos.

Lokal speichert die Erweiterung den kurzlebigen Zugriffstoken und rotierenden
Refresh-Token, einen vom Server gelieferten Kontonamen sowie opake Vorgangs-IDs
und kategorielle Zustände. `chrome.storage.local` ist nicht als verschlüsselt
zu verstehen; der Zugriff ist auf vertrauenswürdige Extension-Kontexte
begrenzt. PDF-Bytes, Dateiname, Drucktitel, Portal-/Blob-/S3-URL, Cookies,
signierte Uploadfelder und Request-Header werden nicht dauerhaft in der
Erweiterung gespeichert.

Die Erweiterung enthält keine Werbung, kein Nutzertracking und verkauft oder
teilt keine Daten zu Werbezwecken. Die Netzwerkkommunikation ist auf die exakt
konfigurierte Fin3000-API und Quarantäne-Origin beschränkt.

Mit **Verbindung trennen** werden Tokens und ausstehende lokale Vorgangsdaten
gelöscht; der Refresh-Token wird zusätzlich bestmöglich serverseitig widerrufen.
Kontodaten und bereits angenommene Dokumente werden dadurch nicht aus Fin3000
gelöscht. Fragen oder Löschanliegen werden über die im Fin3000-Impressum und
im verbundenen Konto genannten Support- und Datenschutzkontakte bearbeitet.
