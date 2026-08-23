# CloudPulse Billing FAQ

Answers to the most common questions about payment methods, invoices, currency, proration, and
what happens when a payment fails.

## What payment methods does CloudPulse accept?

CloudPulse processes credit card payments through Stripe for all plans. Enterprise customers on
an annual contract may additionally pay via ACH bank transfer — ACH is not available for monthly
Enterprise billing or for any Pro plan billing cycle, monthly or annual. Debit cards are accepted
anywhere a credit card is accepted, since Stripe treats them identically.

## What currency is CloudPulse billed in?

All CloudPulse subscriptions, invoices, and add-on charges are billed exclusively in US dollars
(USD). There is no local-currency billing option in any region, including for Enterprise customers
who choose EU (`eu-west-1`) data residency for hosting — billing currency is independent of hosting
region.

## Where can I download my invoices?

Invoices are available as PDF downloads from **Settings → Billing → Invoices**. Every successful
charge — subscription renewals, prorated upgrade charges, and one-time add-on purchases like
priority onboarding or custom integration development — generates its own invoice in that list,
going back to the account's first payment.

## How does proration work when I upgrade my plan?

Upgrades take effect immediately, and the price difference is prorated and charged right away. For
example, upgrading from Pro to Enterprise mid-billing-cycle charges you immediately for the
prorated difference between the two plans for the remainder of the current cycle, and your next
full invoice reflects the new plan's price. This applies whether you're moving from Free to Pro,
Pro to Enterprise, or adding seats to an existing Pro or Enterprise plan.

## How does proration work when I downgrade my plan?

Downgrades are handled differently from upgrades: they do not take effect immediately. Instead, a
downgrade (Enterprise to Pro, or Pro to Free) is scheduled to take effect at the start of your next
billing cycle, and you keep full access to your current plan's features until that date. No partial
refund is issued for the unused portion of the current cycle when downgrading — see the CloudPulse
Subscription Return & Refund Policy for the separate 30-day refund window, which is a different
process from a downgrade.

## What happens if my payment fails?

If a scheduled charge fails — for example, an expired card — CloudPulse retries the payment
automatically up to 3 times over a 7-day window. You'll receive an email notification after each
failed attempt with a link to update your payment method from **Settings → Billing**. If all 3
retry attempts fail across the full 7 days, the workspace is suspended: members lose write access
to boards and tasks (the workspace becomes read-only) until a valid payment method is added and the
outstanding balance is charged successfully.

## Can I add or update my payment method before a charge fails?

Yes. Go to **Settings → Billing → Payment Method** at any time to add a new card or replace an
expired one. Updating your payment method does not trigger an immediate charge on its own — the
next charge occurs on your regular billing date, or immediately if a retry was already pending.

## Do annual plans really save money compared to monthly billing?

Yes. Pro is $12/user/month billed monthly, or $10/user/month billed annually — a savings of $2 per
user per month, equivalent to paying for 10 months and getting 12. Enterprise pricing starts at
$25/user/month for 50 or more seats and is negotiated as a custom annual or monthly contract with
your account manager.

## Is there a discount for nonprofits or educational institutions?

Yes. Verified nonprofit and educational organizations receive 50% off both the Pro and Enterprise
plans. This discount can be combined with annual billing's built-in 2-months-free structure.
Contact `billing@cloudpulse.io` with proof of nonprofit or educational status to apply the
discount to your workspace.

## Are add-on purchases billed separately from my subscription?

Yes. Extra storage (available on Pro only, $5/month per additional 10GB), custom integration
development (starting at $2,000 one-time), and priority onboarding ($500 one-time, including a
2-hour kickoff call) are all billed as separate line items from your recurring subscription charge,
and each generates its own invoice under **Settings → Billing → Invoices**.

## Who do I contact for a billing question not covered here?

Email `billing@cloudpulse.io` or open a ticket from **Settings → Help → Contact Support**. Pro
customers are covered by a 24-hour email support SLA; Enterprise customers have a 4-hour dedicated
support SLA plus a named account manager who can be reached directly for billing escalations.
