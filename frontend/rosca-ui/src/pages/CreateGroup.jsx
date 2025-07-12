import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ethers } from "ethers";
import RoscaFactoryArtifact from "@/contracts/RoscaFactory.json";
import { useUser } from "@/components/common/UserContext";

const FACTORY_ADDRESS = "0x63baa0518010c1197048bc51d46b8A9B5E2764D9";
const PROVIDER_URL = "http://localhost:7545";

export default function CreateGroup() {
  const navigate = useNavigate();
  const { selectedAccount } = useUser();

  const [contribution, setContribution] = useState("");
  const [members, setMembers] = useState("");
  const [intervalDays, setIntervalDays] = useState("0.0007");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!contribution || !members || !intervalDays) {
      alert("Please fill out all fields");
      return;
    }

    if (parseFloat(contribution) <= 0 || parseInt(members) < 2 || parseFloat(intervalDays) <= 0) {
      alert("Enter valid values: contribution > 0, members >= 2, interval > 0");
      return;
    }

    try {
      setLoading(true);

      const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
      const wallet = new ethers.Wallet(selectedAccount.key, provider);
      const factory = new ethers.Contract(FACTORY_ADDRESS, RoscaFactoryArtifact.abi, wallet);
      const iface = new ethers.Interface(RoscaFactoryArtifact.abi); // ✅ correct for Ethers v6+

      const tx = await factory.createGroup(
        ethers.parseEther(contribution),
        Math.floor(parseFloat(intervalDays) * 24 * 60 * 60),
        parseInt(members),
        false
      );

      const receipt = await tx.wait();

      const groupCreatedLog = receipt.logs
        .map((log) => {
          try {
            return iface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "GroupCreated");

      if (!groupCreatedLog) {
        throw new Error("GroupCreated event not found in logs");
      }

      const newGroupAddress = groupCreatedLog.args.group;
      alert("✅ Group created successfully!");
      navigate(`/group/${newGroupAddress}`);
    } catch (err) {
      console.error("❌ Create group failed:", err);
      alert("❌ Transaction failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

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
            <label className="block mb-1 text-sm font-medium text-gray-200">
              Interval (Days) <span className="text-gray-400">(e.g. 0.0007 ≈ 60s)</span>
            </label>
            <input
              type="number"
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              placeholder="e.g. 0.0007"
              className="w-full px-4 py-3 rounded bg-white/10 text-white border border-white/20 focus:outline-none"
              step="0.0001"
            />
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-gray-200">Total Members</label>
            <input
              type="number"
              value={members}
              onChange={(e) => setMembers(e.target.value)}
              placeholder="e.g. 3"
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
  );
}
