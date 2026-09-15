import AdminApp from "../components/AdminApp"

/** Backend URL is server configuration read at request time, so one build serves any environment. */
export const dynamic = "force-dynamic"

export default function Page() {
  const backendUrl = process.env.AMBORAS_BACKEND_URL || "http://localhost:9000"
  return <AdminApp backendUrl={backendUrl} />
}
