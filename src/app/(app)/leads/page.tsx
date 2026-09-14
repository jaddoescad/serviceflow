import { permanentRedirect } from "next/navigation";

export default function LegacyLeadsPage() {
  permanentRedirect("/deals");
}
