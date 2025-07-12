import { createContext, useContext, useState } from "react";

// Test accounts from Ganache (replace with your own)
const testAccounts = [
  {
    label: "User 1",
    key: "0xf3bc1b152f1b324f209c922e35c4328ea01fbc7654af4178826cd52ec6f536d3"
  },
  {
    label: "User 2",
    key: "0xf56d45e596750c699c677d569f2dd4a8fecb5e5373f3120b65b74775e81e89e9"
  },
  {
    label: "User 3",
    key: "0xdf909fbdfdb14f5188411e4aff111936065fbf7cea72ea4851cd82d457d71483"
  }
];

const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [selectedAccount, setSelectedAccount] = useState(testAccounts[0]);
  return (
    <UserContext.Provider value={{ selectedAccount, setSelectedAccount, testAccounts }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);
