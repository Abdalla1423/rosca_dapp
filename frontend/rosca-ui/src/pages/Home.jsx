import { useNavigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function Home() {
  const navigate = useNavigate()

  return (
    <Card className="w-full max-w-md rounded-2xl bg-white/10 backdrop-blur-md shadow-xl">
      <CardContent className="p-6 space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-100">Welcome to ROSCA</h1>
          <p className="text-sm text-gray-400">Choose how you'd like to start</p>
        </div>

        <div className="space-y-4">
          <Button
            className="w-full py-4 sm:py-5 text-base sm:text-lg bg-indigo-700 hover:bg-indigo-800 text-white"
            onClick={() => navigate("/create")}
          >
            ➕ Create a Group
          </Button>

          <Button
            variant="outline"
            className="w-full py-4 sm:py-5 text-base sm:text-lg text-gray-300 border-gray-500 hover:bg-white/10"
            onClick={() => navigate("/join")}
          >
            🔑 Join a Group
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
