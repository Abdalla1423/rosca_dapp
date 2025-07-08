import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import RoscaFactoryABI from "@/contracts/RoscaFactory.json";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/common/UserContext";

const FACTORY_ADDRESS = "0x63baa0518010c1197048bc51d46b8A9B5E2764D9";
const PROVIDER_URL = "http://localhost:7545";

export default function JoinGroup() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { selectedAccount, setSelectedAccount, testAccounts } = useUser();

  useEffect(() => {
    async function fetchGroups() {
      try {
        const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
        const factory = new ethers.Contract(FACTORY_ADDRESS, RoscaFactoryABI.abi, provider);
        const allGroups = await factory.getAllGroups();
        setGroups(allGroups);
      } catch (err) {
        console.error("❌ Failed to fetch groups:", err);
        alert("❌ Could not load groups");
      }
    }

    fetchGroups();
  }, []);

  return (
    <div className="p-6 space-y-6 w-full max-w-4xl">
      <h1 className="text-3xl font-bold text-white mb-4">Join a ROSCA Group</h1>

      <select
        className="w-full p-2 rounded bg-white text-black"
        onChange={(e) =>
          setSelectedAccount(testAccounts.find((a) => a.label === e.target.value))
        }
        value={selectedAccount.label}
      >
        {testAccounts.map((acc) => (
          <option key={acc.label} value={acc.label}>{acc.label}</option>
        ))}
      </select>

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((groupAddress, index) => (
          <Card
            key={groupAddress}
            className="bg-white/10 backdrop-blur-md text-white shadow-lg rounded-xl"
          >
            <CardContent className="p-4 space-y-2">
              <h2 className="text-xl font-semibold">Group #{index + 1}</h2>
              <p className="text-sm break-all">{groupAddress}</p>
              <Button
                onClick={() => navigate(`/group/${groupAddress}`)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Join Group
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
