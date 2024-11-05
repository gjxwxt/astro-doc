import { useRef } from "react";
import { useEffect } from "react";
import gsap from "gsap";

const MouseIcon = () => {
  const shadeMask = useRef();
  const MouseIcon = useRef();

  useEffect(() => {
    const xTo = gsap.quickTo(MouseIcon.current, "x", {
      duration: 0.3,
      ease: "power3",
    });
    const yTo = gsap.quickTo(MouseIcon.current, "y", {
      duration: 0.3,
      ease: "power3",
    });

    const handleMouseMove = (e) => {
      xTo(e.clientX - MouseIcon.current.offsetWidth / 2);
      yTo(e.clientY - MouseIcon.current.offsetHeight / 2);
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <>
      <div
        ref={shadeMask}
        className="h-full w-full fixed z-50 pointer-events-none"
      >
        <div
          id="mouse-icon"
          ref={MouseIcon}
          className="absolute w-4 h-4 bg-red-500 rounded-full pointer-events-none"
        ></div>
      </div>
    </>
  );
};

export default MouseIcon;
