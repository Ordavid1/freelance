# Chrome Web Store listing: Freelance Place — XPlace Import (v0.2.0)

Source of truth for the listing text in the Chrome Web Store developer dashboard (item `pmdpcogbhahimnbipapekgimgpkfnomn`, publisher `ordavidone`). The text matches what the extension does today (`extensions/xplace-import/README.md`). Nothing here is submitted without Or.

## Store listing tab

| Field | Value |
|---|---|
| Title (from package) | `Freelance Place — XPlace Import` |
| Summary (from package, max 132 characters) | `העבירו את הפרופיל והפרויקטים שלכם מ־XPlace אל Freelance Place בלחיצה אחת, ובדקו הכול לפני השמירה.` (97 characters; needs the Hebrew `_locales` entry, see "Package" below) |
| Category | Workflow and planning |
| Language | Hebrew |
| Homepage / Support URL | the Freelance Place site origin |

### Description (Hebrew, shown to users)

```
העבירו את הפרופיל והפרויקטים שלכם מ־XPlace אל Freelance Place, בלי להקליד הכול מחדש.

איך זה עובד
1. אחרי ההתקנה מופיעה בדפי XPlace הזמנה קטנה של Freelance Place, בפינת המסך. בעמוד הפרופיל או הפרויקט שלכם היא נפתחת בגדול.
2. לוחצים על "העתקת הפרופיל" או "ייבוא הפרויקט".
3. התוסף קורא את הפרופיל או הפרויקט שלכם ופותח את Freelance Place, שם אתם בודקים ועורכים הכול לפני שמירה או פרסום.

מה התוסף קורא (רק אחרי שלחצתם)
• בפרופיל: כותרת, תיאור, מיקום, שפות, תחומי התמחות, ניסיון תעסוקתי, השכלה וקישורים.
• בפרויקט: כותרת, תיאור, תקציב, תאריך יעד, תחומי הפרויקט ושם המפרסם.
• לא נקראים: ביקורות, מי צפה בפרופיל, מספרי טלפון, הודעות והצעות של אחרים.
• לפני הלחיצה לא נקרא ולא נשלח דבר.

שליטה ופרטיות
• לא משנים ולא מוחקים דבר ב־XPlace.
• המידע נשמר בדפדפן עד שעה ונשלח רק ל־Freelance Place, בלשונית שנפתחת בעקבות הלחיצה שלכם.
• אפשר ללחוץ "לא עכשיו" או "אל תציגו שוב", ולהחזיר את ההזמנה בהגדרות התוסף.
• אין אנליטיקה ואין קוד חיצוני.

התוסף מיועד להעברת תוכן שלכם. Freelance Place אינה קשורה ל־XPlace ואינה מאושרת על ידה.
```

## Privacy tab

| Field | Value |
|---|---|
| Single purpose | `Help users move their own XPlace profile and projects into their Freelance Place account: it shows an invitation on XPlace pages and, only after the user clicks, copies the user's own page content to Freelance Place for review.` |
| `storage` justification | `Stores the user's invitation preferences (dismissed, snoozed) locally, and holds the captured profile or project content temporarily (up to one hour, session storage) until the user's Freelance Place tab reads it.` |
| Host permission justification | `Content scripts run on xplace.com pages to detect profile and project pages, show the invitation and, only after a click, read the user's own page sections. They also run on freelance-place.com/profile/import* and /projects/new* to hand the staged data to the page the user is reviewing. No other sites are accessed and there are no host permissions.` |
| Data collected | Personally identifiable information and Website content (the user's own XPlace profile or project text, sent to Freelance Place after a click) |
| Privacy policy URL | the Freelance Place privacy page; its wording must cover the import first (draft in `docs/xplace-import.md`) |
| Certifications (three boxes) | Or ticks them: they are the publisher's legal attestation |

## Test instructions tab (max 500 characters)

```
Needs a free XPlace account (xplace.com), logged in. Open your own profile (xplace.com/il/u/<your-name>): a card appears bottom-right. Click "העתקת הפרופיל": a freelance-place.com/profile/import tab opens (Google sign-in needed there) with the imported data to review. Nothing is read before the click. Reviewer account: <XPlace test account, to be provided by Or>.
```

Decision for Or: the Web Store reviewers can only see the main flow with an XPlace account that has a profile. Create a dedicated demo XPlace account and put its credentials in the credentials fields of this tab.

## Distribution tab

Visibility Public or Unlisted is Or's choice (Unlisted is the safer first release). Regions: 88 countries were selected on 11-11-26 (United States, Europe, Türkiye, Caucasus, Middle East incl. Israel, Africa).

## Screenshots (1280x800, no real personal data)

1. The invitation card on a sample XPlace profile page.
2. The XPlace source card in the Freelance Place profile studio after an import.
3. The project composer with an imported draft and the publisher block.

Capture them from the Playwright harness (`npm run test:e2e` in the extension folder loads the unpacked extension over fixture pages) so they show invented sample data, not a real person.

## Package

`npm run package` in `extensions/xplace-import/` writes `dist/freelance-place-xplace-import-0.2.0.zip`. To show the Hebrew summary in the Store the manifest should use `default_locale: "he"` with `_locales/he/messages.json` and `_locales/en/messages.json` for `extName` and `extDescription`.

## Rollout order

1. Merge the website PR (everything ships dark).
2. Set `XPLACE_IMPORT_ENABLED=true` on the production service.
3. Submit the extension in the Web Store; after approval set `NEXT_PUBLIC_XPLACE_EXTENSION_URL` to the listing URL.
4. Optional later: `XPLACE_LINK_IMPORT_ENABLED=true` for the paste-link option.
