import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import RoscaFactoryABI from "@/contracts/RoscaFactory.json";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Update with your deployed Factory address
const FACTORY_ADDRESS = "0xc7E4846c5091Bf4d623d6B6607BAA3036d0D5662";
const PROVIDER_URL = "http://localhost:7545";

export default function JoinGroup() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchGroups() {
      try {
        const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
        const factory = new ethers.Contract(
          FACTORY_ADDRESS,
          RoscaFactoryABI.abi,
          provider
        );

        const allGroups = await factory.getAllGroups();
        setGroups(allGroups);
      } catch (err) {
        console.error("❌ Failed to fetch groups:", err);
        alert("❌ Could not load groups");
      }
    }

    fetchGroups();
  }, []);

  const handleJoin = (groupAddress) => {
    navigate(`/group/${groupAddress}`);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold text-white">Join a ROSCA Group</h1>
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
                onClick={() => handleJoin(groupAddress)}
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
