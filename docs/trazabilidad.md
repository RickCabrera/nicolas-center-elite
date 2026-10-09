# Trazabilidad del backlog

Generado con `node scripts/trace.mjs`. Para cada tarea: dónde se implementa y qué prueba la cubre.
Una tarea sin pruebas listadas se verificó por revisión visual o es documentación.

## INF

| Tarea | Código | Pruebas |
| --- | --- | --- |
| INF-01 | — | — |
| INF-02 | `src/lib/env.ts` | — |
| INF-03 | — | `tests/db/model.test.ts` |
| INF-04 | — | `tests/db/model.test.ts` |
| INF-05 | `src/lib/api.ts` | — |
| INF-06 | `.github/workflows/ci.yml` | — |
| INF-07 | `src/lib/dates.ts` | — |
| INF-08 | `src/lib/api.ts` | — |

## UI

| Tarea | Código | Pruebas |
| --- | --- | --- |
| UI-01 | `src/app/globals.css` | — |
| UI-02 | `src/components/ui.tsx` | — |
| UI-03 | `src/app/globals.css` | — |
| UI-04 | `src/app/manifest.ts`<br>`src/components/icons.tsx` | — |
| UI-05 | `src/app/globals.css` | — |
| UI-06 | `src/app/globals.css` | — |
| UI-07 | `src/app/globals.css` | — |

## DB

| Tarea | Código | Pruebas |
| --- | --- | --- |
| DB-01 | — | `tests/db/model.test.ts` |
| DB-02 | — | `tests/db/model.test.ts` |
| DB-03 | — | `tests/db/model.test.ts` |
| DB-04 | — | `tests/db/model.test.ts` |
| DB-05 | — | `tests/db/model.test.ts` |
| DB-06 | — | `tests/db/model.test.ts` |
| DB-07 | — | `tests/db/model.test.ts` |
| DB-08 | — | `tests/db/model.test.ts` |
| DB-09 | — | `tests/db/model.test.ts` |
| DB-10 | `db/migrations/0005_audit_rls.sql` | — |
| DB-11 | — | `tests/db/model.test.ts` |
| DB-12 | `scripts/seed-demo.ts` | — |

## AUTH

| Tarea | Código | Pruebas |
| --- | --- | --- |
| AUTH-01 | `src/app/api/auth/login/route.ts` | — |
| AUTH-02 | `src/app/(auth)/cambiar-contrasena/page.tsx`<br>`src/app/api/auth/forgot/route.ts`<br>`src/app/api/auth/password/route.ts`<br>`src/app/api/auth/reset/route.ts`<br>`src/components/set-password.tsx`<br>`src/modules/profile/security-cards.tsx` | — |
| AUTH-03 | `src/app/api/auth/reset/route.ts`<br>`src/app/api/users/[id]/invite/route.ts`<br>`src/app/api/users/route.ts`<br>`src/components/set-password.tsx`<br>`src/lib/auth/tokens.ts` | — |
| AUTH-04 | `src/app/(auth)/login/page.tsx`<br>`src/app/api/auth/passkeys/[id]/route.ts`<br>`src/app/api/auth/passkeys/login-options/route.ts`<br>`src/app/api/auth/passkeys/register-options/route.ts`<br>`src/app/api/auth/passkeys/register-verify/route.ts`<br>`src/modules/profile/security-cards.tsx` | — |
| AUTH-05 | `db/migrations/0005_audit_rls.sql` | `tests/db/schema.test.ts` |
| AUTH-06 | — | `tests/api/studies.test.ts` |
| AUTH-07 | `src/app/(app)/(owner)/layout.tsx`<br>`src/components/no-access.tsx`<br>`src/components/shell.tsx` | — |
| AUTH-08 | `src/lib/auth/password.ts`<br>`src/lib/auth/session.ts` | — |
| AUTH-09 | `src/app/api/users/[id]/deactivate/route.ts`<br>`src/modules/team/deactivate-wizard.tsx` | `tests/api/team.test.ts` |
| AUTH-10 | `CONVENTIONS.md`<br>`db/migrations/0013_reception_role.sql`<br>`scripts/seed-demo.ts`<br>`src/app/(app)/(clinical)/layout.tsx`<br>`src/app/(app)/(front)/layout.tsx`<br>`src/app/(app)/(front)/mensualidades/page.tsx`<br>(+35) | `tests/api/reception.test.ts`<br>`tests/db/reception.test.ts`<br>`tests/e2e/flujos.spec.ts`<br>`tests/helpers.ts` |

## PAC

| Tarea | Código | Pruebas |
| --- | --- | --- |
| PAC-01 | `src/app/api/patients/route.ts`<br>`src/modules/patients/types.ts` | `tests/api/patients.test.ts` |
| PAC-02 | `src/app/(app)/pacientes/page.tsx` | — |
| PAC-03 | `CONVENTIONS.md`<br>`db/migrations/0002_clinical.sql`<br>`src/app/api/patients/route.ts`<br>`src/lib/dates.ts`<br>`src/modules/patients/new-patient-sheet.tsx`<br>`src/modules/patients/patient-form.tsx`<br>(+1) | `tests/api/patients.test.ts`<br>`tests/e2e/flujos.spec.ts` |
| PAC-04 | `db/migrations/0002_clinical.sql`<br>`src/app/api/patients/[id]/assign/route.ts`<br>`src/app/api/patients/reassign/route.ts`<br>`src/app/api/patients/route.ts`<br>`src/modules/patients/new-patient-sheet.tsx`<br>`src/modules/patients/server.ts`<br>(+1) | `tests/api/patients.test.ts` |
| PAC-05 | `src/app/api/patients/[id]/route.ts`<br>`src/app/api/patients/[id]/status/route.ts`<br>`src/modules/patients/edit-patient-sheet.tsx`<br>`src/modules/patients/patient-form.tsx`<br>`src/modules/patients/server.ts`<br>`src/modules/patients/status-sheet.tsx` | `tests/api/patients.test.ts` |
| PAC-06 | `src/app/api/patients/route.ts`<br>`src/modules/billing/membership.ts`<br>`src/modules/patients/new-patient-sheet.tsx` | `tests/api/patients.test.ts` |
| PAC-07 | `src/modules/patients/new-patient-sheet.tsx`<br>`src/modules/record/consents-panel.tsx` | — |
| PAC-08 | `db/migrations/0002_clinical.sql`<br>`src/app/api/patients/[id]/consents/route.ts`<br>`src/modules/record/consent-sheet.tsx`<br>`src/modules/record/consent-text.ts`<br>`src/modules/record/consents-panel.tsx`<br>`src/modules/record/server.ts` | `tests/api/record.test.ts` |
| PAC-09 | `src/app/api/patients/import/route.ts`<br>`src/modules/patients/csv.ts`<br>`src/modules/patients/import-sheet.tsx`<br>`src/modules/patients/import.ts`<br>`src/modules/patients/server.ts` | `tests/api/patients.test.ts`<br>`tests/unit/csv.test.ts` |

## EXP

| Tarea | Código | Pruebas |
| --- | --- | --- |
| EXP-01 | `src/app/(app)/pacientes/[id]/page.tsx`<br>`src/app/api/patients/[id]/profile/route.ts`<br>`src/modules/record/reassign-patient-sheet.tsx`<br>`src/modules/record/record-screen.tsx` | `tests/api/record.test.ts` |
| EXP-02 | `db/migrations/0002_clinical.sql`<br>`src/app/api/patients/[id]/profile/route.ts`<br>`src/modules/record/profile-tab.tsx` | `tests/api/record.test.ts` |
| EXP-03 | `CONVENTIONS.md`<br>`src/app/api/patients/[id]/exercises/[exerciseId]/route.ts`<br>`src/app/api/patients/[id]/exercises/reorder/route.ts`<br>`src/app/api/patients/[id]/exercises/route.ts`<br>`src/modules/record/exercises.tsx` | `tests/api/record.test.ts` |
| EXP-04 | `db/migrations/0002_clinical.sql`<br>`src/app/api/patients/[id]/notes/route.ts`<br>`src/modules/record/note-sheet.tsx`<br>`src/modules/record/notes-tab.tsx` | `tests/api/record.test.ts`<br>`tests/e2e/flujos.spec.ts` |
| EXP-05 | `src/modules/record/notes-tab.tsx`<br>`src/modules/record/pain-chart.tsx` | — |
| EXP-06 | `src/modules/record/record-screen.tsx` | — |
| EXP-07 | `src/app/api/patients/[id]/summary/route.ts`<br>`src/lib/pdf.ts` | `tests/api/record.test.ts` |
| EXP-08 | `src/app/api/patients/[id]/access-log/route.ts`<br>`src/modules/record/access-tab.tsx` | `tests/api/record.test.ts` |
| EXP-09 | `db/migrations/0002_clinical.sql` | — |
| EXP-10 | `db/migrations/0002_clinical.sql`<br>`src/app/api/patients/[id]/consents/[consentId]/pdf/route.ts`<br>`src/app/api/patients/[id]/consents/route.ts`<br>`src/modules/record/consent-sheet.tsx`<br>`src/modules/record/consent-text.ts`<br>`src/modules/record/consents-panel.tsx`<br>(+2) | `tests/api/record.test.ts` |

## EST

| Tarea | Código | Pruebas |
| --- | --- | --- |
| EST-01 | `src/app/api/studies/[id]/route.ts`<br>`src/app/api/studies/route.ts`<br>`src/lib/storage/index.ts`<br>`src/modules/studies/server.ts`<br>`src/modules/studies/types.ts`<br>`src/modules/studies/viewer.tsx` | `tests/api/studies.test.ts` |
| EST-02 | `src/app/api/studies/[id]/complete/route.ts`<br>`src/app/api/studies/route.ts`<br>`src/modules/studies/file-rules.ts`<br>`src/modules/studies/patient-studies.tsx`<br>`src/modules/studies/server.ts`<br>`src/modules/studies/upload-sheet.tsx` | `tests/api/studies.test.ts`<br>`tests/unit/dicom.test.ts` |
| EST-03 | `src/app/(app)/(clinical)/estudios/page.tsx`<br>`src/app/api/studies/route.ts`<br>`src/modules/studies/study-card.tsx` | `tests/api/studies.test.ts` |
| EST-04 | `src/modules/studies/dicom.ts`<br>`src/modules/studies/patient-studies.tsx`<br>`src/modules/studies/viewer.tsx` | `tests/unit/dicom.test.ts` |
| EST-05 | `src/app/api/studies/route.ts`<br>`src/modules/studies/study-card.tsx`<br>`src/modules/studies/thumbs.ts`<br>`src/modules/studies/upload-sheet.tsx` | — |
| EST-06 | `src/app/api/studies/[id]/archive/route.ts`<br>`src/app/api/studies/[id]/route.ts`<br>`src/app/api/studies/route.ts`<br>`src/modules/studies/viewer.tsx` | `tests/api/studies.test.ts` |

## AGE

| Tarea | Código | Pruebas |
| --- | --- | --- |
| AGE-01 | `db/migrations/0003_operations.sql`<br>`src/app/api/appointments/route.ts`<br>`src/modules/agenda/server.ts` | `tests/api/agenda.test.ts` |
| AGE-02 | `src/app/(app)/agenda/page.tsx`<br>`src/app/api/appointments/days/route.ts`<br>`src/app/api/appointments/route.ts` | `tests/api/agenda.test.ts` |
| AGE-03 | `src/modules/agenda/new-appointment-sheet.tsx` | `tests/e2e/flujos.spec.ts` |
| AGE-04 | `src/app/api/appointments/[id]/cancel/route.ts`<br>`src/app/api/appointments/[id]/route.ts`<br>`src/modules/agenda/appointment-sheet.tsx`<br>`src/modules/agenda/new-appointment-sheet.tsx` | `tests/api/agenda.test.ts` |
| AGE-05 | `db/migrations/0004_functions.sql`<br>`src/app/api/appointments/[id]/status/route.ts`<br>`src/modules/agenda/appointment-sheet.tsx` | `tests/api/agenda.test.ts` |
| AGE-06 | `src/app/api/catalogs/[kind]/route.ts`<br>`src/modules/settings/catalogs-tab.tsx` | `tests/api/settings.test.ts` |
| AGE-07 | `db/migrations/0003_operations.sql`<br>`src/app/api/schedule/blocks/[id]/route.ts`<br>`src/app/api/schedule/blocks/route.ts`<br>`src/app/api/schedule/hours/route.ts`<br>`src/modules/agenda/hours-editor.tsx`<br>`src/modules/agenda/server.ts` | `tests/api/agenda.test.ts` |
| AGE-08 | `src/app/api/appointments/[id]/cancel/route.ts`<br>`src/app/api/appointments/route.ts`<br>`src/modules/agenda/new-appointment-sheet.tsx`<br>`src/modules/agenda/server.ts` | `tests/api/agenda.test.ts` |
| AGE-09 | `src/modules/agenda/appointment-sheet.tsx` | `tests/api/agenda.test.ts` |

## REC

| Tarea | Código | Pruebas |
| --- | --- | --- |
| REC-01 | `src/app/api/documents/route.ts`<br>`src/modules/documents/shared.ts` | `tests/api/documents.test.ts` |
| REC-02 | `db/migrations/0003_operations.sql`<br>`src/app/api/documents/route.ts` | `tests/api/documents.test.ts`<br>`tests/e2e/flujos.spec.ts` |
| REC-03 | `src/modules/documents/new-document-sheet.tsx` | — |
| REC-04 | `db/migrations/0003_operations.sql`<br>`src/app/api/documents/route.ts` | `tests/api/documents.test.ts` |
| REC-05 | `db/migrations/0003_operations.sql`<br>`src/app/api/documents/[id]/cancel/route.ts`<br>`src/app/api/documents/route.ts`<br>`src/modules/documents/server.ts` | `tests/api/documents.test.ts` |
| REC-06 | `db/migrations/0003_operations.sql`<br>`src/app/api/documents/controlled/route.ts`<br>`src/app/api/documents/route.ts`<br>`src/modules/documents/new-document-sheet.tsx` | `tests/api/documents.test.ts` |
| REC-07 | `src/modules/documents/new-document-sheet.tsx` | `tests/e2e/flujos.spec.ts` |
| REC-08 | `src/app/(app)/(clinical)/recetas/[id]/page.tsx`<br>`src/app/api/documents/[id]/pdf/route.ts`<br>`src/app/api/documents/[id]/print/route.ts`<br>`src/app/api/documents/[id]/route.ts`<br>`src/lib/pdf.ts`<br>`src/modules/documents/document-paper.tsx`<br>(+2) | `tests/api/documents.test.ts` |
| REC-09 | `src/app/(app)/(clinical)/recetas/page.tsx`<br>`src/app/api/documents/route.ts`<br>`src/modules/documents/document-row.tsx` | `tests/api/documents.test.ts` |
| REC-10 | `src/app/api/documents/route.ts`<br>`src/modules/documents/document-row.tsx`<br>`src/modules/documents/patient-documents.tsx` | `tests/api/documents.test.ts` |

## PAG

| Tarea | Código | Pruebas |
| --- | --- | --- |
| PAG-01 | `src/app/api/plans/[id]/route.ts`<br>`src/app/api/plans/route.ts`<br>`src/modules/billing/plan-schema.ts`<br>`src/modules/billing/plans-settings.tsx` | `tests/api/billing.test.ts` |
| PAG-02 | `db/migrations/0003_operations.sql`<br>`src/app/api/billing/memberships/[patientId]/route.ts`<br>`src/modules/billing/membership-panel.tsx`<br>`src/modules/billing/plan-picker-sheet.tsx`<br>`src/modules/billing/server.ts` | `tests/api/billing.test.ts` |
| PAG-03 | `db/migrations/0003_operations.sql`<br>`db/migrations/0004_functions.sql`<br>`src/app/api/billing/route.ts`<br>`src/app/api/cron/daily/route.ts`<br>`src/modules/billing/rules.ts` | `tests/api/billing.test.ts`<br>`tests/api/settings.test.ts` |
| PAG-04 | `src/app/api/billing/payments/route.ts`<br>`src/modules/billing/payment-sheet.tsx`<br>`src/modules/billing/rules.ts`<br>`src/modules/billing/server.ts` | `tests/api/billing.test.ts`<br>`tests/unit/billing.test.ts` |
| PAG-05 | `db/migrations/0003_operations.sql`<br>`src/app/api/billing/payments/[id]/void/route.ts`<br>`src/modules/billing/membership-panel.tsx`<br>`src/modules/billing/rules.ts`<br>`src/modules/billing/server.ts` | `tests/api/billing.test.ts`<br>`tests/unit/billing.test.ts` |
| PAG-06 | `src/app/(app)/(front)/mensualidades/page.tsx`<br>`src/app/api/billing/route.ts`<br>`src/modules/billing/payment-sheet.tsx` | `tests/api/billing.test.ts` |
| PAG-07 | `db/migrations/0004_functions.sql` | `tests/api/billing.test.ts` |
| PAG-08 | `src/app/api/billing/payments/[id]/receipt/route.ts`<br>`src/lib/pdf.ts`<br>`src/modules/billing/payment-sheet.tsx`<br>`src/modules/billing/rules.ts` | `tests/api/billing.test.ts` |
| PAG-09 | `src/app/api/billing/memberships/[patientId]/route.ts`<br>`src/modules/billing/plan-picker-sheet.tsx`<br>`src/modules/billing/rules.ts`<br>`src/modules/billing/server.ts` | `tests/api/billing.test.ts`<br>`tests/unit/billing.test.ts` |
| PAG-10 | `src/app/(app)/(front)/mensualidades/page.tsx`<br>`src/app/api/billing/report/route.ts`<br>`src/modules/billing/income-report.tsx`<br>`src/modules/billing/rules.ts` | `tests/api/billing.test.ts` |
| PAG-11 | `db/migrations/0003_operations.sql`<br>`src/app/api/plans/[id]/route.ts` | `tests/api/billing.test.ts` |
| PAG-12 | `src/app/(app)/(front)/mensualidades/page.tsx`<br>`src/app/api/billing/payment-links/[id]/route.ts`<br>`src/app/api/billing/payment-links/route.ts`<br>`src/app/api/billing/settings/route.ts`<br>`src/app/api/webhooks/stripe/route.ts`<br>`src/app/pago/cancelado/page.tsx`<br>(+6) | `tests/api/online-billing.test.ts` |

## HUE

| Tarea | Código | Pruebas |
| --- | --- | --- |
| HUE-01 | `src/app/api/devices/[id]/command/route.ts`<br>`src/app/api/devices/[id]/route.ts`<br>`src/app/api/devices/[id]/secrets/route.ts`<br>`src/app/api/devices/route.ts`<br>`src/modules/attendance/device-schema.ts`<br>`src/modules/attendance/devices-settings.tsx`<br>(+1) | `tests/api/attendance.test.ts` |
| HUE-02 | `src/app/api/hik/events/[token]/route.ts`<br>`src/modules/attendance/hik-parser.ts` | `tests/api/attendance.test.ts`<br>`tests/unit/hik-parser.test.ts` |
| HUE-03 | `src/app/api/hik/events/[token]/route.ts`<br>`src/modules/attendance/hik-parser.ts`<br>`src/modules/attendance/server.ts` | — |
| HUE-04 | `db/migrations/0004_functions.sql`<br>`src/app/api/hik/events/[token]/route.ts`<br>`src/modules/attendance/hik-parser.ts`<br>`src/modules/attendance/server.ts` | `tests/unit/hik-parser.test.ts` |
| HUE-05 | `bridge/bridge.mjs`<br>`bridge/install-windows.ps1`<br>`src/app/api/bridge/events/route.ts`<br>`src/app/api/bridge/heartbeat/route.ts`<br>`src/app/api/bridge/poll/route.ts`<br>`src/app/api/bridge/result/route.ts`<br>(+1) | `tests/api/attendance.test.ts`<br>`tests/bridge/bridge.test.ts` |
| HUE-06 | `bridge/bridge.mjs`<br>`db/migrations/0003_operations.sql`<br>`src/app/api/bridge/poll/route.ts`<br>`src/app/api/devices/[id]/command/route.ts`<br>`src/app/api/enrollments/[commandId]/route.ts`<br>`src/modules/attendance/server.ts`<br>(+1) | `tests/bridge/bridge.test.ts` |
| HUE-07 | `CONVENTIONS.md`<br>`bridge/bridge.mjs`<br>`src/app/api/bridge/progress/route.ts`<br>`src/app/api/bridge/result/route.ts`<br>`src/app/api/enrollments/[commandId]/route.ts`<br>`src/app/api/enrollments/route.ts`<br>(+2) | `tests/api/attendance.test.ts`<br>`tests/bridge/bridge.test.ts`<br>`tests/unit/hik-parser.test.ts` |
| HUE-08 | `bridge/bridge.mjs`<br>`src/app/api/bridge/events/route.ts` | `tests/bridge/bridge.test.ts` |
| HUE-09 | `db/migrations/0004_functions.sql` | `tests/api/attendance.test.ts` |
| HUE-10 | `src/app/(app)/huella/page.tsx`<br>`src/app/api/attendance/route.ts`<br>`src/app/api/attendance/status/route.ts`<br>`src/modules/attendance/attendance-screen.tsx`<br>`src/modules/attendance/server.ts` | `tests/api/attendance.test.ts` |
| HUE-11 | `src/app/api/attendance/route.ts`<br>`src/modules/attendance/attendance-screen.tsx` | `tests/api/attendance.test.ts`<br>`tests/e2e/flujos.spec.ts` |
| HUE-12 | `src/app/api/attendance/report/route.ts`<br>`src/modules/attendance/hours.ts`<br>`src/modules/attendance/reports-tab.tsx` | `tests/api/attendance.test.ts`<br>`tests/unit/hik-parser.test.ts` |
| HUE-13 | `bridge/bridge.mjs`<br>`src/app/api/bridge/result/route.ts`<br>`src/app/api/enrollments/route.ts`<br>`src/app/api/patients/[id]/status/route.ts`<br>`src/app/api/users/[id]/deactivate/route.ts`<br>`src/modules/attendance/enroll-fingerprint.tsx`<br>(+1) | `tests/api/attendance.test.ts`<br>`tests/api/patients.test.ts`<br>`tests/bridge/bridge.test.ts` |
| HUE-14 | `src/app/api/attendance/simulate/route.ts`<br>`src/lib/env.ts`<br>`src/modules/attendance/attendance-screen.tsx` | `tests/api/attendance.test.ts` |
| HUE-15 | `src/app/api/attendance/route.ts`<br>`src/modules/attendance/attendance-screen.tsx`<br>`src/modules/attendance/server.ts` | `tests/api/attendance.test.ts` |
| HUE-16 | `bridge/bridge.mjs`<br>`db/migrations/0003_operations.sql`<br>`src/app/api/bridge/result/route.ts`<br>`src/app/api/hik/events/[token]/route.ts`<br>`src/modules/attendance/enroll-fingerprint.tsx`<br>`src/modules/attendance/hik-parser.ts`<br>(+1) | `tests/api/attendance.test.ts`<br>`tests/bridge/bridge.test.ts`<br>`tests/db/schema.test.ts`<br>`tests/unit/hik-parser.test.ts` |

## DASH

| Tarea | Código | Pruebas |
| --- | --- | --- |
| DASH-01 | `src/app/(app)/inicio/page.tsx`<br>`src/app/api/dashboard/route.ts`<br>`src/modules/dashboard/dashboard-view.tsx`<br>`src/modules/dashboard/types.ts` | `tests/api/dashboard.test.ts` |
| DASH-02 | — | `tests/api/dashboard.test.ts` |
| DASH-03 | `src/app/api/dashboard/route.ts`<br>`src/modules/dashboard/dashboard-view.tsx` | `tests/api/dashboard.test.ts` |
| DASH-04 | `src/modules/dashboard/dashboard-view.tsx` | — |

## CFG

| Tarea | Código | Pruebas |
| --- | --- | --- |
| CFG-01 | `src/app/(app)/(owner)/configuracion/page.tsx`<br>`src/app/api/clinic/route.ts`<br>`src/modules/settings/clinic-tab.tsx`<br>`src/modules/settings/server.ts` | `tests/api/settings.test.ts` |
| CFG-02 | `src/app/api/locations/[id]/route.ts`<br>`src/app/api/locations/route.ts`<br>`src/modules/settings/location-schema.ts`<br>`src/modules/settings/locations-tab.tsx` | `tests/api/settings.test.ts` |
| CFG-03 | `src/app/api/plans/[id]/route.ts`<br>`src/app/api/plans/route.ts`<br>`src/modules/billing/plans-settings.tsx` | — |
| CFG-04 | `src/app/api/devices/route.ts`<br>`src/modules/attendance/device-schema.ts`<br>`src/modules/attendance/devices-settings.tsx` | — |
| CFG-05 | `src/app/api/catalogs/[kind]/route.ts`<br>`src/modules/settings/catalogs-tab.tsx`<br>`src/modules/settings/shared.ts` | `tests/api/settings.test.ts` |
| CFG-06 | `db/migrations/0001_base.sql`<br>`src/app/api/clinic/route.ts`<br>`src/modules/settings/params-tab.tsx`<br>`src/modules/settings/shared.ts` | `tests/api/settings.test.ts` |
| CFG-07 | `src/app/api/clinic/route.ts`<br>`src/modules/settings/default-templates.ts`<br>`src/modules/settings/shared.ts`<br>`src/modules/settings/templates-tab.tsx` | `tests/api/settings.test.ts` |
| CFG-08 | `src/app/(app)/perfil/page.tsx`<br>`src/app/api/auth/passkeys/route.ts`<br>`src/app/api/auth/password/route.ts`<br>`src/app/api/profile/route.ts`<br>`src/app/api/profile/sessions/route.ts`<br>`src/modules/profile/profile-view.tsx`<br>(+3) | `tests/api/team.test.ts` |
| CFG-09 | `src/app/api/audit/route.ts`<br>`src/modules/settings/audit-labels.ts`<br>`src/modules/settings/audit-tab.tsx` | `tests/api/settings.test.ts` |
| CFG-10 | `src/app/(app)/(owner)/configuracion/page.tsx`<br>`src/app/api/export/backup/route.ts`<br>`src/app/api/export/patient/[id]/route.ts`<br>`src/modules/settings/data-tab.tsx`<br>`src/modules/settings/server.ts` | `tests/api/settings.test.ts` |

## EQ

| Tarea | Código | Pruebas |
| --- | --- | --- |
| EQ-01 | `src/app/(app)/(owner)/equipo/page.tsx`<br>`src/app/api/users/route.ts`<br>`src/app/api/users/workload/route.ts`<br>`src/modules/team/server.ts`<br>`src/modules/team/team-view.tsx` | `tests/api/team.test.ts` |
| EQ-02 | `src/app/api/users/[id]/invite/route.ts`<br>`src/app/api/users/route.ts`<br>`src/modules/team/server.ts`<br>`src/modules/team/therapist-sheet.tsx`<br>`src/modules/team/ui.tsx` | `tests/api/team.test.ts` |
| EQ-03 | `src/app/api/users/[id]/route.ts`<br>`src/modules/team/server.ts`<br>`src/modules/team/therapist-sheet.tsx` | `tests/api/team.test.ts` |
| EQ-04 | `src/app/api/users/[id]/deactivate/route.ts`<br>`src/app/api/users/[id]/reactivate/route.ts`<br>`src/modules/team/deactivate-wizard.tsx` | `tests/api/team.test.ts` |
| EQ-05 | `src/app/api/users/workload/route.ts` | `tests/api/team.test.ts` |
| EQ-06 | `src/modules/team/therapist-sheet.tsx` | — |
| EQ-07 | `src/modules/team/reassign-sheet.tsx` | — |

## LEG

| Tarea | Código | Pruebas |
| --- | --- | --- |
| LEG-01 | — | — |
| LEG-02 | — | — |
| LEG-03 | `src/app/(app)/(owner)/configuracion/page.tsx`<br>`src/app/api/arco/[id]/route.ts`<br>`src/app/api/arco/route.ts`<br>`src/app/api/privacy/route.ts`<br>`src/app/privacidad/page.tsx`<br>`src/modules/settings/arco-form.tsx`<br>(+3) | `tests/api/settings.test.ts` |
| LEG-04 | `.github/workflows/ci.yml` | — |
| LEG-05 | `scripts/legal-packet.ts` | — |

## QA

| Tarea | Código | Pruebas |
| --- | --- | --- |
| QA-01 | — | `tests/unit/billing.test.ts` |
| QA-02 | — | `tests/api/agenda.test.ts`<br>`tests/api/attendance.test.ts`<br>`tests/api/billing.test.ts`<br>`tests/api/dashboard.test.ts`<br>`tests/api/documents.test.ts`<br>`tests/api/online-billing.test.ts`<br>(+5) |
| QA-03 | `playwright.config.ts` | `tests/e2e/flujos.spec.ts` |
| QA-04 | — | `tests/unit/hik-parser.test.ts` |
| QA-05 | — | — |
| QA-06 | `scripts/dev/perf.mjs` | — |

## DEP

| Tarea | Código | Pruebas |
| --- | --- | --- |
| DEP-01 | `scripts/setup-storage.mjs`<br>`src/app/api/cron/daily/route.ts` | `tests/api/settings.test.ts` |
| DEP-02 | `src/app/(auth)/setup/page.tsx`<br>`src/app/api/setup/route.ts` | — |
| DEP-03 | `bridge/install-windows.ps1` | — |
| DEP-04 | — | — |
| DEP-05 | — | — |
| DEP-06 | `db/migrations/0010_restorable_functions.sql`<br>`scripts/backup.mjs` | — |

## FAC

| Tarea | Código | Pruebas |
| --- | --- | --- |
| FAC-01 | `src/app/api/billing/tax-profiles/[patientId]/route.ts`<br>`src/modules/invoicing/invoice-sheet.tsx`<br>`src/modules/invoicing/schema.ts`<br>`src/modules/invoicing/server.ts` | `tests/api/online-billing.test.ts` |
| FAC-02 | `src/app/api/invoices/route.ts`<br>`src/modules/invoicing/invoice-sheet.tsx`<br>`src/modules/invoicing/server.ts` | `tests/api/online-billing.test.ts` |
| FAC-03 | `src/app/api/invoices/global/route.ts`<br>`src/modules/invoicing/invoices-tab.tsx`<br>`src/modules/invoicing/server.ts` | `tests/api/online-billing.test.ts` |
| FAC-04 | `src/app/api/invoices/[id]/route.ts`<br>`src/modules/invoicing/invoices-tab.tsx`<br>`src/modules/invoicing/server.ts` | `tests/api/online-billing.test.ts` |
| FAC-05 | `src/app/api/billing/settings/route.ts`<br>`src/modules/invoicing/billing-settings-tab.tsx` | — |
| FAC-06 | `src/app/(app)/(front)/mensualidades/page.tsx`<br>`src/app/api/invoices/[id]/file/route.ts`<br>`src/app/api/invoices/[id]/route.ts`<br>`src/app/api/invoices/route.ts`<br>`src/modules/invoicing/invoices-tab.tsx`<br>`src/modules/invoicing/server.ts` | `tests/api/online-billing.test.ts` |

