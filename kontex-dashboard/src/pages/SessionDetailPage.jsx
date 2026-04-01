import { useParams } from "react-router-dom";

export default function SessionDetailPage() {
  const { id } = useParams();
  return (
    <div className="p-6">
      <h1 className="font-sans text-lg text-text">Session {id}</h1>
    </div>
  );
}
