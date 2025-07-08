import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import RoscaABI from "@/contracts/Rosca.json";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useUser } from "@/components/common/UserContext";

const PROVIDER_URL = "http://localhost:7545";

export default function GroupDetail() {
  const { address } = useParams();
  const { selectedAccount, setSelectedAccount, testAccounts } = useUser();
  const [info, setInfo] = useState(null);
  const [isParticipant, setIsParticipant] = useState(false);
  const [hasContributed, setHasContributed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);

  const provider = useMemo(() => new ethers.JsonRpcProvider(PROVIDER_URL), []);
  const wallet = useMemo(() => {
    try {
      return new ethers.Wallet(selectedAccount.key, provider);
    } catch (err) {
      console.error("Wallet init failed:", err);
      return null;
    }
  }, [selectedAccount, provider]);

  const rosca = useMemo(() => {
    if (!wallet || !address) return null;
    return new ethers.Contract(address, RoscaABI.abi, wallet);
  }, [wallet, address]);

  useEffect(() => {
    async function fetchInfo() {
      try {
        if (!rosca) return;

        const [
          contribution,
          interval,
          started,
          currentCycle,
          maxParticipants,
          nextPayoutTime,
          allParticipants,
        ] = await Promise.all([
          rosca.contributionAmount(),
          rosca.interval(),
          rosca.started(),
          rosca.currentCycle(),
          rosca.maxParticipants(),
          rosca.nextPayoutTime(),
          rosca.getParticipants(),
        ]);

        const joined = await rosca.isParticipant(wallet.address);
        const contributed = await rosca.hasContributed(currentCycle, wallet.address);

        setIsParticipant(joined);
        setHasContributed(contributed);

        setInfo({
          contribution: ethers.formatEther(contribution),
          interval: Number(interval) / (60 * 60 * 24),
          nextPayoutTime: Number(nextPayoutTime),
          started,
          currentCycle,
          maxParticipants,
          participantCount: allParticipants.length,
          participants: allParticipants,
        });
      } catch (err) {
        console.error("Failed to load group info:", err);
        alert("❌ Failed to load group details: " + err.message);
      }
    }

    fetchInfo();
  }, [rosca]);

  useEffect(() => {
    if (!info?.nextPayoutTime) return;

    const intervalId = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, info.nextPayoutTime - now);
      setTimeLeft(remaining);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [info?.nextPayoutTime]);

  const joinGroup = async () => {
    try {
      setLoading(true);
      const tx = await rosca.join({ value: 0 });
      await tx.wait();
      alert("✅ Joined group successfully!");
      setIsParticipant(true);
    } catch (err) {
      alert("❌ Join failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const contribute = async () => {
    try {
      setLoading(true);
      const tx = await rosca.contribute({
        value: await rosca.contributionAmount(),
      });
      await tx.wait();
      alert("✅ Contribution successful!");
      setHasContributed(true);
    } catch (err) {
      alert("❌ Contribution failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const triggerPayout = async () => {
    try {
      setLoading(true);
      if (!rosca) {
        alert("Contract not initialized.");
        return;
      }

      const started = await rosca.started();
      const nextPayoutTime = await rosca.nextPayoutTime();
      const currentCycle = await rosca.currentCycle();
      const now = Math.floor(Date.now() / 1000);

      console.log("🔍 Debug Info:");
      console.log("Started:", started);
      console.log("Current Time:", now);
      console.log("Next Payout Time:", Number(nextPayoutTime));
      console.log("Interval passed?", now >= Number(nextPayoutTime));
      console.log("Current Cycle:", Number(currentCycle));

      const participants = await rosca.getParticipants();
      for (let i = 0; i < participants.length; i++) {
        const hasPaid = await rosca.hasContributed(currentCycle, participants[i]);
        console.log(`Participant ${i} (${participants[i]}) contributed: ${hasPaid}`);
      }

      // Safe check for callStatic and simulation
      if (rosca.callStatic && typeof rosca.callStatic.triggerPayout === "function") {
        try {
          await rosca.callStatic.triggerPayout();
        } catch (simErr) {
          console.error("❌ Simulated call failed:", simErr);
          alert("🚫 TriggerPayout would fail: " + (simErr.reason || simErr.message || "Unknown error"));
          return;
        }
      } else {
        console.warn("⚠️ rosca.callStatic.triggerPayout is not defined");
        alert("⚠️ triggerPayout is not available in ABI. Please verify your ABI and deployment.");
        return;
      }

      const tx = await rosca.triggerPayout();
      await tx.wait();
      alert("✅ Payout triggered!");
    } catch (err) {
      console.error("❌ Payout failed:", err);
      alert("❌ Payout failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!info) {
    return <p className="text-white p-6">Loading group info...</p>;
  }

  return (
    <div className="p-6 flex flex-col items-center space-y-6">
      <select
        className="w-full max-w-xs p-2 rounded bg-white text-black"
        onChange={(e) =>
          setSelectedAccount(testAccounts.find((a) => a.label === e.target.value))
        }
        value={selectedAccount.label}
      >
        {testAccounts.map((acc) => (
          <option key={acc.label} value={acc.label}>
            {acc.label}
          </option>
        ))}
      </select>

      <Card className="max-w-xl w-full rounded-xl bg-white/10 backdrop-blur text-white shadow-xl">
        <CardContent className="p-6 space-y-4">
          <h1 className="text-2xl font-bold mb-4">ROSCA Group Details</h1>
          <p><strong>Address:</strong> <code>{address}</code></p>
          <p><strong>Contribution:</strong> {info.contribution} ETH</p>
          <p><strong>Interval:</strong> {info.interval} days</p>
          <p><strong>Cycle:</strong> {info.currentCycle}</p>
          <p><strong>Participants:</strong> {info.participantCount} / {info.maxParticipants}</p>
          <p><strong>Started:</strong> {info.started ? "Yes" : "No"}</p>
          {info.started && (
            <p><strong>Time until payout allowed:</strong> {timeLeft} seconds</p>
          )}

          {!isParticipant && !info.started && (
            <Button disabled={loading} onClick={joinGroup} className="w-full">
              {loading ? "Joining..." : "Join Group"}
            </Button>
          )}

          {isParticipant && info.started && !hasContributed && (
            <Button disabled={loading} onClick={contribute} className="w-full bg-green-600">
              {loading ? "Contributing..." : "Contribute"}
            </Button>
          )}

          {isParticipant && info.started && (
            <Button
              disabled={loading || timeLeft > 0}
              onClick={triggerPayout}
              className="w-full bg-yellow-600"
            >
              {loading ? "Triggering..." : timeLeft > 0 ? `Wait ${timeLeft}s` : "Trigger Payout"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
