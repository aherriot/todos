import { useContext } from "react";
import ToastContext from "./ToastContext";

const useToast = () => {
  const { showToast } = useContext(ToastContext);
  return showToast;
};

export default useToast;
