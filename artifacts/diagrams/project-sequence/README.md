# Project sequence diagrams

All diagrams are Mermaid `.mmd` files for the Mermaid Preview extension. Mermaid sequence diagrams do not support PlantUML `ref` frames, so the overview uses labeled reference sections and this index provides clickable links to each detailed diagram.

| Diagram | Summary |
| --- | --- |
| [Overview](project-overview.mmd) | Shows how authentication, booking, clinic operations, and cancellations connect through the app, scheduling service, and database. |
| [Authentication](project-authentication.mmd) | Shows patient and staff code sign-in, admin PIN sign-in, and current versus planned email delivery paths. |
| [Patient booking and WhatsApp](patient-booking-whatsapp.mmd) | Shows slot confirmation, patient appointment listing, and consent-based post-commit WhatsApp attempts. |
| [Clinic setup and staff booking](clinic-operations.mmd) | Shows doctor settings and staff management, the shared clinic booking path, agenda, and local email preview. |
| [Patient cancellation and rebooking](patient-cancellation.mmd) | Shows an owned patient cancellation and the separate rebooking flow. |
| [Clinic cancellation](clinic-cancellation.mmd) | Shows doctor/admin and staff cancellation permissions and the resulting agenda updates. |

`project-sequence-legacy.mmd` preserves the original single, dense diagram. The modular Mermaid set above is its replacement.
