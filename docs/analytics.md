# Website analytics

GA4 stream: 16314000462. Measurement ID: G-CM5KEE7G13.

The root layout loads the Google tag directly. The old GTM loader is replaced to avoid configuring two competing delivery paths. Events are queued until Google loads. Do not also deploy a GA4 configuration tag in GTM without reviewing duplicate collection.

| Event | Meaning |
| --- | --- |
| page_view | Initial page and pathname navigation |
| ui_click | Button/link interaction; element_id, element_type, page_path |
| profile_generation_started | User invoked AI generation |
| profile_generation_completed | AI response succeeded (excludes demo fallback) |
| profile_generation_demo | Demo fallback response |
| profile_saved | Profile save succeeded |
| project_publish_started | User submitted publishing |
| project_published | Project creation succeeded |
| project_application_started | User submitted an application |
| project_application_submitted | Application succeeded (excludes demo) |
| project_application_demo | Demo application response |

## GA4 administration still required

Mark profile_generation_completed, profile_saved, project_published and project_application_submitted as key events in Admin > Events. Register event-scoped custom dimensions for element_id, element_type and page_path to use them in exploration reports. Confirm events in Realtime and DebugView after deployment. Review Enhanced Measurement settings: disable history-based page views because this app sends them explicitly. Automatic form tracking is unnecessary for these custom action events.

Use Reports > Acquisition > Traffic acquisition for sessions, source/medium, campaigns, engagement and key-event rates. Use User acquisition for first-user origin. Build explorations for profile generation started → completed → saved, and publishing/application started → success. Event counts measure actions; Total users measures distinct users performing an action. Use consistent utm_source, utm_medium and utm_campaign on campaign links. Standard reports can take 24–48 hours to populate.

Generic click identifiers use CSS classes unless data-analytics-id is supplied. Repeated controls can share an identifier; add a stable data-analytics-id when finer reporting is required. Visible text, submitted content, profile information, and arbitrary URL query values are not deliberately included in custom parameters. Campaign values must never contain personal information. Google automatic collection settings should be reviewed in the property.

Browser blocking, consent choices and network failures can prevent analytics delivery. This is browser analytics, not an authoritative transaction ledger. Successful writes remain recorded in the application database. No production event delivery or property configuration has been verified in this workspace.
