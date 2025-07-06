import { useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";

export default function GroupDetail() {
  const { address } = useParams();

  return (
    <div className="p-6 flex justify-center">
      <Card className="max-w-xl w-full rounded-xl bg-white/10 backdrop-blur text-white shadow-xl">
        <CardContent className="p-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-4">Group Details</h1>
          <p>You joined the group at:</p>
          <code className="block bg-black/40 p-2 rounded mt-2 break-all">{address}</code>
        </CardContent>
      </Card>
    </div>
  );
}
