import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ethers } from "ethers"
import RoscaFactoryABI from "@/contracts/RoscaFactory.json"

// 🏭 Update with your most recent deployed factory address from Truffle
const FACTORY_ADDRESS = "0xc7E4846c5091Bf4d623d6B6607BAA3036d0D5662";



// 🗝️ Private key from Ganache account #0 (keep this secret in real apps)
const PRIVATE_KEY = "0xf3bc1b152f1b324f209c922e35c4328ea01fbc7654af4178826cd52ec6f536d3"
const PROVIDER_URL = "http://localhost:7545"

export default function CreateGroup() {
  const navigate = useNavigate()

  const [contribution, setContribution] = useState("")
  const [members, setMembers] = useState("")
  const [duration, setDuration] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!contribution || !members || !duration) {
      alert("Please fill out all fields")
      return
    }

    try {
      setLoading(true)

      const provider = new ethers.JsonRpcProvider(PROVIDER_URL)
      const wallet = new ethers.Wallet(PRIVATE_KEY, provider)

      const factory = new ethers.Contract(FACTORY_ADDRESS, RoscaFactoryABI.abi, wallet)

      const tx = await factory.createGroup(
        ethers.parseEther(contribution),                     // ETH → Wei
        parseInt(duration) * 7 * 24 * 60 * 60,                // weeks → seconds
        parseInt(members),
        false                                                 // useCollateral
      )

      await tx.wait()

      alert("✅ Group created successfully!")
      navigate("/join")
    } catch (error) {
      console.error("Create group failed:", error)
      alert("❌ Transaction failed: " + error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md rounded-2xl bg-white/10 backdrop-blur-md shadow-xl text-white">
      <CardContent className="p-6 space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-center">Create a New ROSCA Group</h1>
        <p className="text-sm text-center text-gray-300">Set up your savings circle</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-200">Contribution (ETH)</label>
            <input
              type="text"
              value={contribution}
              onChange={(e) => setContribution(e.target.value)}
              placeholder="e.g. 0.1"
              className="w-full px-4 py-3 rounded bg-white/10 text-white border border-white/20 focus:outline-none"
            />
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-gray-200">Duration (Weeks)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 4"
              className="w-full px-4 py-3 rounded bg-white/10 text-white border border-white/20 focus:outline-none"
            />
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-gray-200">Total Members</label>
            <input
              type="number"
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              placeholder="e.g. 5"
              className="w-full px-4 py-3 rounded bg-white/10 text-white border border-white/20 focus:outline-none"
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-indigo-700 hover:bg-indigo-800 text-white"
          >
            {loading ? "Creating..." : "Create Group"}
          </Button>
        </form>

        <Button
          variant="outline"
          className="w-full py-3 text-gray-300 border-gray-500 hover:bg-white/10"
          onClick={() => navigate("/")}
        >
          ⬅️ Back to Menu
        </Button>
      </CardContent>
    </Card>
  )
}
