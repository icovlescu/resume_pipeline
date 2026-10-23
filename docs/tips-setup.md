# Setting up tips (Ko-fi + Stripe)

Tips are optional and unlock nothing; the tool stays free. Money flows
supporter → Ko-fi page → Stripe → your bank (a Revolut IBAN works).

## 1. Create the Ko-fi page
1. Sign up at <https://ko-fi.com/account/register>.
2. Pick the page name. It becomes `https://ko-fi.com/<name>`; `icovlescu`
   matches the GitHub account.
3. Add a short description, e.g. "Tips for resume_pipeline, a free tool that
   finds matching roles and tailors CVs without invented skills."

## 2. Connect Stripe
1. On Ko-fi go to **Settings → Payment** and click **Connect** next to Stripe.
2. In the Stripe window, sign up with email and password and save the backup
   code Stripe shows you.
3. Country: **Netherlands**. Business type: **Individual**.
4. Personal details and ID check (name, date of birth, address, phone, ID).
5. Website: `https://github.com/icovlescu/resume_pipeline`. Description:
   "Voluntary tips for a free open-source tool. No goods or services are sold."
6. Payout account: your Revolut IBAN, in your own name.
7. Public details: the name supporters see on their statement.
8. Stripe sends you back to Ko-fi. Open Stripe's verification email.

## 3. Check it works
- Ko-fi **Settings → Payment** shows Stripe as connected.
- In the Stripe Dashboard, **Settings → Payouts** shows the IBAN and schedule.
  The first payout usually arrives within 7 days, then on a rolling schedule.
- Optional: send yourself a €1 tip from another card and watch it arrive.

## 4. Wire the link into the repo
Set `https://ko-fi.com/<name>` in:
- `.github/FUNDING.yml`: `ko_fi: <name>` (shows GitHub's Sponsor button)
- `README.md`: the Support section
- `docs/pages/pipeline-mockup.html`: `data-tip-url` on the tip footer

## 5. Keep records
Export Stripe payouts once a year and declare tips minus costs as
"resultaat uit overige werkzaamheden" in box 1. This is general information,
not tax advice.
