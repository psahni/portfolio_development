# Project sequence diagrams

The overview uses PlantUML `ref` frames to point to focused interaction diagrams. Each detail diagram keeps to seven or fewer participants.

| Diagram | Summary |
| --- | --- |
| [Overview](project-overview.puml) | Shows how authentication, booking, clinic operations and cancellations connect through the app, scheduling service and database. |
| [Authentication](project-authentication.puml) | Shows patient and staff code sign-in, admin PIN sign-in, and the current versus planned email delivery paths. |
| [Patient booking and WhatsApp](patient-booking-whatsapp.puml) | Shows slot confirmation, patient appointment listing, and consent-based post-commit WhatsApp attempts. |
| [Clinic setup and staff booking](clinic-operations.puml) | Shows doctor settings and staff management, the shared clinic booking path, agenda, and local email preview. |
| [Patient cancellation and rebooking](patient-cancellation.puml) | Shows an owned patient cancellation and the separate rebooking flow. |
| [Clinic cancellation](clinic-cancellation.puml) | Shows doctor/admin and staff cancellation permissions and the agenda updates. |

`project-sequence-legacy.mmd` preserves the original single, dense Mermaid diagram. The modular PlantUML set above is its replacement.
