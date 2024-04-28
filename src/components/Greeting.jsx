import { useState } from 'react';

export default function Greeting({ messages }) {

  const randomMessage = () => messages[(Math.floor(Math.random() * messages.length))];

  const [greeting, setGreeting] = useState(messages[0]);
  const buttonStyle = {
    width: '150px',
    height: '42px',
    fontSize: '20px',
    background: 'linear-gradient(45deg, transparent 5%, #FF013C 5%)',
    border: '0',
    color: '#fff',
    letterSpacing: '3px',
    lineHeight: '40px',
    boxShadow: '6px 0px 0px #00E6F6',
    outline: 'transparent',
    position: 'relative',
  };

  return (
    <div>
      <h3>{greeting}! Thank you for visiting!</h3>
      <button style={buttonStyle} onClick={() => setGreeting(randomMessage())}>
        换一个

      </button>

    </div>

  );
}