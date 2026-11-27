import { requireOwner } from "@/lib/owner";
import { NewCompanyForm } from "../forms";

export default async function NewCompany() {
  await requireOwner();
  return (
    <>
      <div>
        <h1>Add a company</h1>
        <p className="sub">Creates their account, sends their first person an invite, and gives them an RFQ forwarding address.</p>
      </div>
      <NewCompanyForm />
    </>
  );
}
