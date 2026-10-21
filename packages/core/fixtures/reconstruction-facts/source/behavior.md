# Current behavior — verified specification, 2026-09-08

Submitting a draft requires a title and positive amount no greater than
500 yuan. Above 200 yuan a receipt must be present. Exactly 200 yuan does not
require a receipt; exactly 500 yuan may be submitted. A failed submission
leaves the draft unchanged and explains the violated condition.

Only the applicant may edit the draft. A submitted request cannot be edited.
Only a reviewer may decide a submitted request. The reviewer cannot decide
their own request, even by opening its direct detail address. A refused action
does not modify the existing request. A rejection requires a reason and retains
that reason with the rejected request; approval does not require one.

When a decision is saved, the applicant receives one in-app notification naming
the request and result, linked to its detail. Email delivery was proposed but
is not implemented and is not an active channel. No external integration is
established by these materials.

Acceptance examples recorded by the product owner:
- An applicant submits a draft for 200 yuan with title and no receipt: it becomes
  submitted. A draft for 201 yuan without a receipt stays draft with a message.
- A draft for 500 yuan with title and receipt becomes submitted. A draft for
  501 yuan stays draft with a limit message.
- A reviewer opens their own submitted request and attempts approval: it stays
  submitted and access is refused.
- A reviewer rejects another person's submitted request with a reason: the
  reason is retained and the applicant receives the in-app result notification.

No measured performance threshold or uptime commitment has been supplied.
These are acceptance specifications, not evidence that tests have been executed.
