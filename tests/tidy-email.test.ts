import { describe, expect, test } from "vitest";
import { tidyEmail } from "@/lib/rfq/tidy-email";

const body = `CAUTION: This email originated from outside of the organisation.

FYI, see below.

Thanks
Dan
[cid:image001.png@01DC1234]
From: Jane Builder <jane@example.com>
Sent: Thursday, 26 November 2026 9:12 AM
To: Dan <dan@example.com>
Subject: RE: Example Road - Asphalt - Request for Quotation.

Hi,

Please note the following project assumptions:

* There will be four establishments
* AC15

Kind regards,
Jane Builder
Senior Estimator
M: 0412 345 678
www.example.com.au <https://www.example.com.au>
[cid:image002.gif@01DC]
Example Pty Ltd | 1 Street, Brisbane QLD 4000

This email and any attachments are confidential and intended only for the addressee.`;

describe("tidyEmail", () => {
  test("keeps each email's message, drops greetings, signatures, logos, banners and disclaimers", () => {
    const p = tidyEmail(body);
    expect(p).toHaveLength(2);
    expect(p[0].text).toBe("FYI, see below.");
    expect(p[1]).toMatchObject({ from: "Jane Builder", subject: "RE: Example Road - Asphalt - Request for Quotation." });
    expect(p[1].text).toBe("Please note the following project assumptions:\n\n* There will be four establishments\n* AC15");
  });
  test("drops a forward that only carries the forwarder's name and title", () => {
    const p = tidyEmail("Dan Soundy\nOperations Manager - QLD\n\nFrom: Ana <ana@example.com>\nSent: Tuesday, 24 November 2026 3:28 PM\nSubject: RFQ\n\nCould you please quote the asphalt.\n\nThanks\nAna");
    expect(p).toHaveLength(1);
    expect(p[0].text).toBe("Could you please quote the asphalt.");
  });
  test("a plain email with no signature stays as it is", () => {
    expect(tidyEmail("Can you price 200 m2 of AC10 at 40 mm?")[0].text).toBe("Can you price 200 m2 of AC10 at 40 mm?");
  });
});
